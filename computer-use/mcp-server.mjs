#!/usr/bin/env node
// MCP server for computer-use via Hammerspoon
// Tools auto-return screenshots after actions for immediate visual feedback

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { platform } from "node:os";
import { hsCall, takeScreenshot, readScreenshot, runOsascript, findElements, clickElement, checkHealth, SCREENSHOT_PATH } from "./hammerspoon.mjs";
import { registerBrowserTools } from "./browser-tools.mjs";
const IS_LINUX = platform() === "linux";

const server = new McpServer({ name: "computer-use", version: "1.0.0" });
const n = z.coerce.number();
const jsonRes = (r) => ({ content: [{ type: "text", text: JSON.stringify(r, null, 2) }] });
const ACTION_DELAY = 1500;
const actionRes = async (text, delay, indicator) => ({
	content: [{ type: "text", text }, ...await takeScreenshot(delay ?? ACTION_DELAY, indicator)]
});

server.tool("screenshot", "Capture screenshot. Use find_elements for precise coordinates.",
	{ x: n.optional().describe("Crop X"), y: n.optional().describe("Crop Y"),
		w: n.optional().describe("Crop width"), h: n.optional().describe("Crop height") },
	async ({ x, y, w, h }) => {
		const body = { path: SCREENSHOT_PATH };
		if (x !== null && y !== null && w !== null && h !== null) Object.assign(body, { x, y, w, h });
		const r = await hsCall("POST", "/screenshot", body);
		if (r.error) return { content: [{ type: "text", text: JSON.stringify(r) }] };
		try {
			const img = readScreenshot();
			return { content: [
				{ type: "image", data: img, mimeType: "image/png" },
				{ type: "text", text: `Screenshot: ${r.width}x${r.height}px (use these coords for clicks)` },
			] };
		} catch { return { content: [{ type: "text", text: JSON.stringify(r) }] }; }
	}
);

server.tool("click", "Click at coordinates. Auto-returns screenshot.",
	{ x: n.describe("X"), y: n.describe("Y"),
		right: z.boolean().optional().describe("Right-click"),
		double: z.boolean().optional().describe("Double-click"),
		modifiers: z.array(z.string()).optional().describe("Modifier keys: shift, cmd, alt, ctrl") },
	async (p) => { await hsCall("POST", "/click", p); return actionRes(`Clicked (${p.x},${p.y})`, 400, {x: p.x, y: p.y}); }
);

server.tool("click_sequence", "Multiple clicks in one call. Auto-returns screenshot.",
	{ clicks: z.array(z.object({
		x: n.describe("X"), y: n.describe("Y"),
		right: z.boolean().optional(), double: z.boolean().optional(),
		modifiers: z.array(z.string()).optional(),
		delay: n.optional().describe("Delay after click ms (default: 300)"),
	})).describe("Array of clicks") },
	async ({ clicks }) => {
		for (const c of clicks) {
			await hsCall("POST", "/click", { x: c.x, y: c.y, right: c.right, double: c.double, modifiers: c.modifiers });
			await new Promise(r => setTimeout(r, c.delay ?? 300));
		}
		const l = clicks[clicks.length - 1];
		return actionRes(`Clicked ${clicks.length} points`, 400, {x: l.x, y: l.y});
	}
);

server.tool("drag", "Drag from one point to another. Auto-returns screenshot.",
	{ startX: n.describe("Start X"), startY: n.describe("Start Y"),
		endX: n.describe("End X"), endY: n.describe("End Y"),
		steps: n.optional().describe("Interpolation steps (default: 10)"),
		duration: n.optional().describe("Duration secs (default: 0.3)") },
	async (p) => {
		await hsCall("POST", "/drag", p);
		return actionRes(`Dragged (${p.startX},${p.startY}) to (${p.endX},${p.endY})`, ((p.duration||0.3)+0.15)*1000);
	}
);

server.tool("type_text", "Type text or press keys. Auto-returns screenshot.",
	{ text: z.string().optional().describe("Text to type"),
		key: z.string().optional().describe("Key name (return, tab, escape, etc)"),
		modifiers: z.array(z.string()).optional().describe("Modifier keys") },
	async (p) => { const r = await hsCall("POST", "/type", p); return actionRes(JSON.stringify(r), 300); }
);

server.tool("type_sequence", "Multiple type/key actions in one call. Auto-returns screenshot.",
	{ actions: z.array(z.object({
		text: z.string().optional(), key: z.string().optional(),
		modifiers: z.array(z.string()).optional(),
		delay: n.optional().describe("Delay after action ms (default: 50)"),
	})).describe("Array of type actions") },
	async ({ actions }) => {
		for (const a of actions) {
			await hsCall("POST", "/type", { text: a.text, key: a.key, modifiers: a.modifiers });
			await new Promise(r => setTimeout(r, a.delay ?? 50));
		}
		return actionRes(`Executed ${actions.length} type actions`, 300);
	}
);

server.tool("scroll", "Scroll at position. Use repeat for long scrolling. Auto-returns screenshot.",
	{ x: n.optional().describe("X"), y: n.optional().describe("Y"),
		direction: z.enum(["up", "down"]).optional().describe("Direction (default: down)"),
		amount: n.optional().describe("Scroll units (default: 3)"),
		repeat: n.optional().describe("Number of scroll events (default: 1)") },
	async ({ x, y, direction, amount, repeat: reps }) => {
		const scrollAmt = (amount || 3) * (direction === "up" ? -1 : 1);
		await hsCall("POST", "/scroll", { x, y, amount: scrollAmt, repeat: reps || 1 });
		return actionRes(`Scrolled ${direction || "down"} x${reps || 1}`, ((reps||1)-1)*50+200);
	}
);

server.tool("type_from_file", "Type text from file (secure password entry). Auto-screenshots.",
	{ path: z.string().describe("Path to file") },
	async ({ path }) => { const r = await hsCall("POST", "/type_from_file", { path }); return actionRes(JSON.stringify(r)); }
);

server.tool("launch_app", "Launch or activate an application. Auto-returns screenshot.",
	{ app: z.string().describe("Application name") },
	async ({ app }) => { await hsCall("POST", "/launch", { app }); return actionRes(`Launched ${app}`, 500); }
);

server.tool("focus_window", "Focus a window by app name. Auto-returns screenshot.",
	{ window_id: n.optional().describe("Window ID"), app: z.string().optional().describe("App name") },
	async (p) => { const r = await hsCall("POST", "/focus", p); return actionRes(JSON.stringify(r), 200); }
);

server.tool("windows", "List all visible windows with positions", {},
	async () => jsonRes(await hsCall("GET", "/windows")));
server.tool("apps", "List running applications", {},
	async () => jsonRes(await hsCall("GET", "/apps")));
server.tool("element_at", "Get UI element info at screen coordinates",
	{ x: n.describe("X"), y: n.describe("Y") },
	async (p) => jsonRes(await hsCall("POST", "/element_at", p)));
server.tool("accessibility_tree", "Get accessibility tree of focused or named app",
	{ app: z.string().optional().describe("App name (default: frontmost)"),
		depth: n.optional().describe("Max tree depth (default: 4)") },
	async (p) => jsonRes(await hsCall("POST", "/accessibility", p, 30000)));
server.tool("find_elements", "Search UI elements by role/title in accessibility tree",
	{ role: z.string().optional().describe("AX role (e.g. AXButton)"),
		title: z.string().optional().describe("Title substring (case-insensitive)"),
		app: z.string().optional().describe("App name (default: frontmost)"),
		limit: n.optional().describe("Max results (default: 30)") },
	async (p) => jsonRes(await findElements(p)));

server.tool("click_element", "Find UI element by title/role and click it. Auto-returns screenshot.",
	{ title: z.string().optional().describe("Title substring"),
		role: z.string().optional().describe("AX role (e.g. AXButton)"),
		app: z.string().optional().describe("App name (default: frontmost)"),
		index: n.optional().describe("Which match to click (default: 0)") },
	async (p) => {
		const r = await clickElement(p);
		if (r.error) return jsonRes(r);
		if (r.method === "AXPress") return actionRes(`Pressed "${r.element.title}" via AXPress`, 500);
		return actionRes(`Clicked "${r.element.title}" at (${r.coords.x},${r.coords.y})`, 400, r.coords);
	}
);

registerBrowserTools(server, IS_LINUX);

server.tool("applescript", "Run AppleScript via osascript.",
	{ code: z.string().describe("AppleScript code") },
	async ({ code }) => {
		let r = await runOsascript(code);
		for (let i = 0; i < 3 && r.timedOut; i++) {
			await hsCall("POST", "/type", { key: "return" }, 3000).catch(() => {});
			await new Promise(res => setTimeout(res, 1000));
			r = await runOsascript(code);
			if (!r.timedOut) break;
		}
		return jsonRes(r);
	}
);

server.tool("reload_config", "Reload Hammerspoon config", {},
	async () => jsonRes(await hsCall("POST", "/reload")));

await checkHealth();
const transport = new StdioServerTransport();
await server.connect(transport);
