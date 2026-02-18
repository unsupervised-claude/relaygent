#!/usr/bin/env node
// MCP server for computer-use
// Backends: Hammerspoon (macOS/Linux) or Android (ADB) via ANDROID_COMPUTER_USE=1

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { platform } from "node:os";
import { readFileSync } from "node:fs";
import { registerDesktopTools } from "./tools-desktop.mjs";

const IS_ANDROID = process.env.ANDROID_COMPUTER_USE === "1";
const IS_LINUX = platform() === "linux";

let backend;
if (IS_ANDROID) {
	backend = await import("./android.mjs");
} else {
	backend = await import("./hammerspoon.mjs");
}

const server = new McpServer({ name: "computer-use", version: "1.0.0" });
const n = z.coerce.number();
const jsonRes = (r) => ({ content: [{ type: "text", text: JSON.stringify(r, null, 2) }] });
const ACTION_DELAY = IS_ANDROID ? 800 : 1500;

async function actionRes(text, delayMs) {
	const d = delayMs ?? ACTION_DELAY;
	const blocks = IS_ANDROID ? await backend.takeScreenshotBlocks(d) : await backend.takeScreenshot(d);
	return { content: [{ type: "text", text }, ...blocks] };
}

server.tool("screenshot", "Capture screenshot. Use find_elements for precise coordinates.",
	{ x: n.optional(), y: n.optional(), w: n.optional(), h: n.optional() },
	async ({ x, y, w, h }) => {
		let label = "Android";
		if (!IS_ANDROID) {
			const body = { path: backend.SCREENSHOT_PATH };
			if (x !== undefined && y !== undefined && w !== undefined && h !== undefined)
				Object.assign(body, { x, y, w, h });
			const r = await backend.hsCall("POST", "/screenshot", body);
			if (r.error) return jsonRes(r);
			label = `${r.width}x${r.height}px`;
		} else {
			if (!backend.takeScreenshot()) return jsonRes({ error: "Screenshot failed" });
		}
		try {
			const img = readFileSync(backend.SCREENSHOT_PATH).toString("base64");
			return { content: [
				{ type: "image", data: img, mimeType: "image/png" },
				{ type: "text", text: `Screenshot: ${label}` },
			] };
		} catch { return jsonRes({ error: "Could not read screenshot" }); }
	}
);

server.tool("click", "Tap/click at coordinates. Auto-returns screenshot.",
	{ x: n.describe("X"), y: n.describe("Y"),
		right: z.boolean().optional(), double: z.boolean().optional(),
		modifiers: z.array(z.string()).optional() },
	async (p) => {
		if (IS_ANDROID) {
			if (p.double) { backend.click(p.x, p.y); await new Promise(r => setTimeout(r, 100)); }
			backend.click(p.x, p.y);
			return actionRes(`Tapped (${p.x},${p.y})`, 600);
		}
		await backend.hsCall("POST", "/click", p);
		return actionRes(`Clicked (${p.x},${p.y})`, 400);
	}
);

server.tool("click_sequence", "Multiple taps/clicks in one call. Auto-returns screenshot.",
	{ clicks: z.array(z.object({
		x: n, y: n, right: z.boolean().optional(), double: z.boolean().optional(),
		modifiers: z.array(z.string()).optional(),
		delay: n.optional().describe("Delay after click ms (default: 300)"),
	})) },
	async ({ clicks }) => {
		for (const c of clicks) {
			if (IS_ANDROID) backend.click(c.x, c.y);
			else await backend.hsCall("POST", "/click", c);
			await new Promise(r => setTimeout(r, c.delay ?? 300));
		}
		return actionRes(`Tapped ${clicks.length} points`, 400);
	}
);

server.tool("drag", "Drag/swipe from one point to another. Auto-returns screenshot.",
	{ startX: n, startY: n, endX: n, endY: n,
		steps: n.optional(), duration: n.optional().describe("Duration secs (default: 0.3)") },
	async (p) => {
		const ms = Math.round((p.duration || 0.3) * 1000);
		if (IS_ANDROID) backend.drag(p.startX, p.startY, p.endX, p.endY, ms);
		else await backend.hsCall("POST", "/drag", p);
		return actionRes(`Dragged (${p.startX},${p.startY}) to (${p.endX},${p.endY})`, ms + 150);
	}
);

server.tool("type_text", "Type text or press keys. Auto-returns screenshot.",
	{ text: z.string().optional(), key: z.string().optional(),
		modifiers: z.array(z.string()).optional() },
	async (p) => {
		if (IS_ANDROID) {
			if (p.text) backend.typeText(p.text);
			if (p.key) backend.pressKey(p.key);
			return actionRes(`Typed "${p.text || p.key}"`, 400);
		}
		const r = await backend.hsCall("POST", "/type", p);
		return actionRes(JSON.stringify(r));
	}
);

server.tool("type_sequence", "Multiple type/key actions in one call. Auto-returns screenshot.",
	{ actions: z.array(z.object({
		text: z.string().optional(), key: z.string().optional(),
		modifiers: z.array(z.string()).optional(), delay: n.optional(),
	})) },
	async ({ actions }) => {
		for (const a of actions) {
			if (IS_ANDROID) {
				if (a.text) backend.typeText(a.text);
				if (a.key) backend.pressKey(a.key);
			} else { await backend.hsCall("POST", "/type", a); }
			await new Promise(r => setTimeout(r, a.delay ?? 50));
		}
		return actionRes(`Executed ${actions.length} type actions`);
	}
);

server.tool("scroll", "Scroll at position. Auto-returns screenshot.",
	{ x: n.optional(), y: n.optional(), direction: z.enum(["up", "down"]).optional(),
		amount: n.optional(), repeat: n.optional() },
	async ({ x, y, direction, amount, repeat: reps }) => {
		const dir = direction || "down"; const r = reps || 1;
		if (IS_ANDROID) {
			for (let i = 0; i < r; i++) {
				backend.scroll(x ?? 540, y ?? 900, dir, amount || 3);
				if (r > 1) await new Promise(res => setTimeout(res, 100));
			}
			return actionRes(`Scrolled ${dir} x${r}`, 400);
		}
		await backend.hsCall("POST", "/scroll", { x, y, amount: (amount||3)*(dir==="up"?-1:1), repeat: r });
		return actionRes(`Scrolled ${dir} x${r}`, (r-1)*50+200);
	}
);

server.tool("find_elements", "Search UI elements by title/text. On Android uses uiautomator.",
	{ role: z.string().optional(), title: z.string().optional(),
		app: z.string().optional(), limit: n.optional() },
	async (p) => jsonRes(IS_ANDROID ? backend.findElements(p) : await backend.findElements(p))
);

server.tool("click_element", "Find UI element by title and tap/click it. Auto-returns screenshot.",
	{ title: z.string().optional(), role: z.string().optional(),
		app: z.string().optional(), index: n.optional() },
	async (p) => {
		if (IS_ANDROID) {
			const { elements } = backend.findElements({ title: p.title, limit: 10 });
			if (!elements.length) return jsonRes({ error: `No element matching "${p.title}"` });
			const el = elements[Math.min(p.index || 0, elements.length - 1)];
			backend.click(el.center.x, el.center.y);
			return actionRes(`Tapped "${p.title}" at (${el.center.x},${el.center.y})`, 600);
		}
		const r = await backend.clickElement(p);
		if (r.error) return jsonRes(r);
		if (r.method === "AXPress") return actionRes(`Pressed "${r.element.title}" via AXPress`, 500);
		return actionRes(`Clicked "${r.element.title}" at (${r.coords.x},${r.coords.y})`, 400);
	}
);

server.tool("launch_app", "Launch app by package name (Android) or app name (macOS/Linux).",
	{ app: z.string() },
	async ({ app }) => {
		if (IS_ANDROID) { backend.launchApp(app); return actionRes(`Launched ${app}`, 1000); }
		await backend.hsCall("POST", "/launch", { app });
		return actionRes(`Launched ${app}`, 500);
	}
);

server.tool("browser_navigate", "Navigate browser to URL. Auto-returns screenshot.",
	{ url: z.string(), new_tab: z.boolean().optional() },
	async ({ url, new_tab }) => {
		if (IS_ANDROID) { backend.browseUrl(url); return actionRes(`Navigated to ${url}`, 2000); }
		const mod = IS_LINUX ? "ctrl" : "cmd";
		await backend.hsCall("POST", "/launch", { app: IS_LINUX ? "google-chrome" : "Google Chrome" });
		await new Promise(r => setTimeout(r, 300));
		await backend.hsCall("POST", "/type", { key: new_tab ? "t" : "l", modifiers: [mod] });
		await new Promise(r => setTimeout(r, 200));
		await backend.hsCall("POST", "/type", { text: url });
		await new Promise(r => setTimeout(r, 100));
		await backend.hsCall("POST", "/type", { key: "return" });
		return actionRes(`Navigated to ${url}`, 1500);
	}
);

if (!IS_ANDROID) registerDesktopTools(server, backend, actionRes, IS_LINUX);

await backend.checkHealth();
const transport = new StdioServerTransport();
await server.connect(transport);
