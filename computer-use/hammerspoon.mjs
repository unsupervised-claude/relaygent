// HTTP client for computer-use backend (Hammerspoon on macOS, linux-server.py on Linux)
// All requests serialized through single TCP connection

import { execFile, execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { platform } from "node:os";
import http from "node:http";

const IS_LINUX = platform() === "linux";
const PORT = parseInt(process.env.HAMMERSPOON_PORT || "8097", 10);
const agent = new http.Agent({ keepAlive: false, maxSockets: 1 });
let tail = Promise.resolve();

const SCREENSHOT_PATH = "/tmp/claude-screenshot.png";
const SCALED_PATH = "/tmp/claude-screenshot-scaled.png";
const MAX_BYTES = 5 * 1024 * 1024; // 5MB — well under Claude's 20MB base64 limit
const MAX_DIM = 1280; // max width/height when downscaling

/** Read screenshot, downscaling if it exceeds MAX_BYTES. Returns base64 string. */
export function readScreenshot() {
	try {
		const size = statSync(SCREENSHOT_PATH).size;
		if (size <= MAX_BYTES) return readFileSync(SCREENSHOT_PATH).toString("base64");
		// Downscale using sips (macOS) or convert (Linux/ImageMagick)
		if (IS_LINUX) {
			execFileSync("convert", [SCREENSHOT_PATH, "-resize", `${MAX_DIM}x${MAX_DIM}>`, SCALED_PATH], { timeout: 5000 });
		} else {
			execFileSync("sips", ["-Z", String(MAX_DIM), "--out", SCALED_PATH, SCREENSHOT_PATH], { timeout: 5000 });
		}
		return readFileSync(SCALED_PATH).toString("base64");
	} catch {
		return readFileSync(SCREENSHOT_PATH).toString("base64");
	}
}

function hsCallOnce(method, path, body, timeoutMs) {
	return new Promise(resolve => {
		const data = body ? JSON.stringify(body) : null;
		const headers = { "Content-Type": "application/json" };
		if (data) headers["Content-Length"] = Buffer.byteLength(data);
		const req = http.request(
			{ hostname: "localhost", port: PORT, path, method, agent, headers, timeout: timeoutMs },
			res => {
				const chunks = [];
				res.on("data", c => chunks.push(c));
				res.on("end", () => {
					try { resolve(JSON.parse(Buffer.concat(chunks))); }
					catch { resolve({ error: "bad json" }); }
				});
			}
		);
		req.on("error", e => resolve({ error: `Hammerspoon unreachable: ${e.message}` }));
		req.on("timeout", () => { req.destroy(); resolve({ error: `Timeout after ${timeoutMs}ms on ${path}` }); });
		if (data) req.write(data);
		req.end();
	});
}

function reloadHammerspoon() {
	if (IS_LINUX) return Promise.resolve(); // No Hammerspoon on Linux
	return new Promise(resolve => {
		execFile("/usr/bin/osascript", ["-e",
			'tell application "Hammerspoon" to execute lua code "hs.reload()"'],
			{ timeout: 5000 }, () => resolve());
	});
}

/** Serialized HTTP call to Hammerspoon. Auto-reloads if unreachable. */
export function hsCall(method, path, body, timeoutMs = 15000) {
	const promise = tail.then(async () => {
		let result = await hsCallOnce(method, path, body, timeoutMs);
		if (result.error?.includes("unreachable")) {
			await reloadHammerspoon();
			await new Promise(r => setTimeout(r, 2000));
			result = await hsCallOnce(method, path, body, timeoutMs);
		}
		return result;
	});
	tail = promise.catch(() => {});
	return promise;
}

/** Take screenshot after delay. Returns MCP content blocks. */
export async function takeScreenshot(delayMs = 300, indicator) {
	await new Promise(r => setTimeout(r, delayMs));
	const body = { path: SCREENSHOT_PATH };
	if (indicator) { body.indicator_x = indicator.x; body.indicator_y = indicator.y; }
	const r = await hsCall("POST", "/screenshot", body);
	if (r.error) return [{ type: "text", text: `(screenshot failed: ${r.error})` }];
	try {
		const img = readScreenshot();
		if (!img) return [{ type: "text", text: `(screenshot empty)` }];
		return [
			{ type: "image", data: img, mimeType: "image/png" },
			{ type: "text", text: `Screenshot: ${r.width}x${r.height}px (use these coords for clicks)` },
		];
	} catch (e) { return [{ type: "text", text: `(screenshot read failed: ${e.message})` }]; }
}

/** Run osascript with timeout (macOS only). */
export function runOsascript(code, ms = 8000) {
	if (IS_LINUX) return Promise.resolve({ success: false, error: "AppleScript not available on Linux" });
	return new Promise(resolve => {
		execFile("/usr/bin/osascript", ["-e", code], { timeout: ms }, (err, stdout, stderr) => {
			if (err?.killed) resolve({ success: false, error: "Timed out", timedOut: true });
			else if (err) resolve({ success: false, error: stderr?.trim() || err.message });
			else resolve({ success: true, result: stdout?.trim() || "" });
		});
	});
}

// Short-lived cache for the a11y tree — reused within a single find→click sequence.
// TTL is intentionally brief (1.5s) so the cache is never stale in real interactions.
const _axCache = new Map(); // key: app|"" → { tree, ts }
const AX_CACHE_TTL = 1500;

function _getCachedTree(app) {
	const key = app || "";
	const entry = _axCache.get(key);
	if (entry && Date.now() - entry.ts < AX_CACHE_TTL) return entry.tree;
	return null;
}

function _setCachedTree(app, tree) {
	_axCache.set(app || "", { tree, ts: Date.now() });
}

/** Search accessibility tree for elements matching role/title. */
export async function findElements({ role, title, app, limit }) {
	const cached = _getCachedTree(app);
	const tree = cached ?? await hsCall("POST", "/accessibility", { app, depth: 8 }, 30000);
	if (tree.error) return { error: tree.error };
	if (!cached) _setCachedTree(app, tree);
	const max = limit || 30;
	const results = [];
	const titleLower = title?.toLowerCase();
	function search(node) {
		if (!node || results.length >= max) return;
		const matchRole = !role || node.role === role;
		const nodeTitle = node.title || "";
		const nodeDesc = node.description || "";
		const matchTitle = !titleLower
			|| nodeTitle.toLowerCase().includes(titleLower)
			|| nodeDesc.toLowerCase().includes(titleLower);
		if (matchRole && matchTitle && (role || title)) {
			results.push({ role: node.role, title: nodeTitle || nodeDesc, frame: node.frame, value: node.value });
		}
		for (const c of node.children || []) {
			if (results.length < max) search(c);
		}
	}
	search(tree.tree);
	return { app: tree.app, count: results.length, elements: results };
}

/** Find element by title/role and click its center. Fallback to AXPress. */
export async function clickElement({ title, role, app, index }) {
	const result = await findElements({ title, role, app, limit: 10 });
	if (result.error) return { error: result.error };
	const valid = result.elements.filter(e => e.frame && e.frame.w > 0 && e.frame.h > 0);
	if (valid.length > 0) {
		const idx = Math.min(index || 0, valid.length - 1);
		const el = valid[idx];
		const x = Math.round(el.frame.x + el.frame.w / 2);
		const y = Math.round(el.frame.y + el.frame.h / 2);
		await hsCall("POST", "/click", { x, y });
		return { clicked: true, element: el, coords: { x, y }, candidates: valid.length };
	}
	if (result.count > 0) {
		const r = await hsCall("POST", "/ax_press", { title, role, app, index: index || 0 });
		if (r.pressed) return { clicked: true, element: { title: r.title, role: r.role }, method: "AXPress" };
		return { error: r.error || "AXPress failed", found: result.count, method: "AXPress" };
	}
	return { error: `No element found matching "${title || role}"` };
}

/** Startup self-test: verify backend is reachable. Logs warning to stderr. */
export async function checkHealth() {
	const r = await hsCallOnce("GET", "/health", null, 3000);
	if (r.error) {
		const backend = IS_LINUX ? "linux-server.py" : "Hammerspoon";
		process.stderr.write(`[computer-use] Warning: ${backend} not reachable (${r.error})\n`);
		return false;
	}
	process.stderr.write(`[computer-use] Backend OK (${r.platform || "macos"})\n`);
	return true;
}

export { SCREENSHOT_PATH };
