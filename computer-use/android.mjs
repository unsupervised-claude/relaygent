// Android computer-use backend via ADB
// Implements the same interface as hammerspoon.mjs but targets Android via ADB/SSH

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ADB = process.env.ADB_HOST ? `adb -H ${process.env.ADB_HOST}` : "adb";
const SSH_HOST = process.env.ANDROID_SSH_HOST || "pixel";
const SSH_PORT = process.env.ANDROID_SSH_PORT || "8022";
const SSH_USER = process.env.ANDROID_SSH_USER || "u0_a305";
const SCREENSHOT_PATH = "/tmp/android-screenshot.png";

function adb(cmd, timeout = 10000) {
	try {
		return execSync(`${ADB} shell "su -c '${cmd}'"`, {
			timeout, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch (e) {
		return `ERROR: ${e.message}`;
	}
}

function ssh(cmd, timeout = 10000) {
	const path = "/data/data/com.termux/files/usr/bin";
	try {
		return execSync(
			`ssh -p ${SSH_PORT} ${SSH_USER}@${SSH_HOST} "export PATH=${path}:$PATH; ${cmd}"`,
			{ timeout, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
		).trim();
	} catch (e) {
		return `ERROR: ${e.message}`;
	}
}

export function takeScreenshot() {
	try {
		execSync(`${ADB} exec-out screencap -p > "${SCREENSHOT_PATH}"`, {
			timeout: 5000, shell: true, stdio: ["pipe", "pipe", "pipe"],
		});
		// Downscale: keep aspect ratio, max width 390px (phone-sized)
		execSync(`sips -Z 768 -s format png "${SCREENSHOT_PATH}" --out "${SCREENSHOT_PATH}"`, {
			timeout: 5000, stdio: ["pipe", "pipe", "pipe"],
		});
		return true;
	} catch {
		return false;
	}
}

export function screenshotContent() {
	const ok = takeScreenshot();
	if (!ok) return null;
	try {
		const data = readFileSync(SCREENSHOT_PATH).toString("base64");
		return { type: "image", data, mimeType: "image/png" };
	} catch { return null; }
}

export async function takeScreenshotBlocks(delayMs = 300) {
	await new Promise(r => setTimeout(r, delayMs));
	const img = screenshotContent();
	if (!img) return [{ type: "text", text: "(screenshot failed)" }];
	return [img, { type: "text", text: "Screenshot captured (Android)" }];
}

export function parseUI() {
	adb("uiautomator dump /sdcard/ui.xml", 15000);
	const xml = adb("cat /sdcard/ui.xml", 5000);
	const elements = [];
	const pat = /text="([^"]*)"[^>]*resource-id="([^"]*)"[^>]*content-desc="([^"]*)"[^>]*clickable="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g;
	let m;
	while ((m = pat.exec(xml)) !== null) {
		const [, text, resourceId, contentDesc, clickable, x1, y1, x2, y2] = m;
		if (text || contentDesc || clickable === "true") {
			elements.push({
				text: text || undefined,
				resourceId: resourceId || undefined,
				contentDesc: contentDesc || undefined,
				clickable: clickable === "true",
				bounds: { x1: +x1, y1: +y1, x2: +x2, y2: +y2 },
				center: { x: Math.round((+x1 + +x2) / 2), y: Math.round((+y1 + +y2) / 2) },
			});
		}
	}
	return elements;
}

export function findElements({ title, role, limit }) {
	const elements = parseUI();
	const q = title?.toLowerCase();
	// Android doesn't have AX roles — match on text/contentDesc only
	const matches = q
		? elements.filter(e =>
			(e.text && e.text.toLowerCase().includes(q)) ||
			(e.contentDesc && e.contentDesc.toLowerCase().includes(q))
		)
		: elements.filter(e => e.clickable);
	return { count: matches.length, elements: matches.slice(0, limit || 30) };
}

export function click(x, y) { adb(`input tap ${x} ${y}`); }

export function drag(x1, y1, x2, y2, durationMs = 300) {
	adb(`input swipe ${x1} ${y1} ${x2} ${y2} ${durationMs}`);
}

export function scroll(x, y, direction, amount = 3) {
	const dist = amount * 200;
	const [dx, dy] = direction === "up" ? [0, dist] : [0, -dist];
	adb(`input swipe ${x} ${y} ${x + dx} ${y + dy} 200`);
}

export function typeText(text) {
	const escaped = text.replace(/['"\\$`!#&|;()<> ]/g, c => `\\${c}`);
	adb(`input text ${escaped}`);
}

export function pressKey(key) {
	const KEY_MAP = {
		return: "66", enter: "66", tab: "61", delete: "67", escape: "111",
		home: "KEYCODE_HOME", back: "KEYCODE_BACK",
		up: "KEYCODE_DPAD_UP", down: "KEYCODE_DPAD_DOWN",
		left: "KEYCODE_DPAD_LEFT", right: "KEYCODE_DPAD_RIGHT",
	};
	adb(`input keyevent ${KEY_MAP[key.toLowerCase()] || key}`);
}

export function launchApp(pkg) {
	adb(`monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);
}

export function browseUrl(url) {
	adb(`am start -a android.intent.action.VIEW -d '${url}'`);
}

export async function checkHealth() {
	const r = adb("echo ok", 3000);
	if (r === "ok") {
		process.stderr.write("[computer-use] Android backend OK (ADB)\n");
		return true;
	}
	process.stderr.write(`[computer-use] Android ADB not reachable: ${r}\n`);
	return false;
}

export { SCREENSHOT_PATH };
