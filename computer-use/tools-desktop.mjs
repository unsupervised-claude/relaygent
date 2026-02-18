// Desktop-only computer-use tools (macOS/Linux, not available on Android)

import { z } from "zod";

const n = z.coerce.number();
const jsonRes = (r) => ({ content: [{ type: "text", text: JSON.stringify(r, null, 2) }] });

export function registerDesktopTools(server, backend, actionRes, IS_LINUX) {
	server.tool("type_from_file", "Type text from file (secure password entry). Auto-screenshots.",
		{ path: z.string() },
		async ({ path }) => { const r = await backend.hsCall("POST", "/type_from_file", { path }); return actionRes(JSON.stringify(r)); }
	);

	server.tool("focus_window", "Focus a window by app name. Auto-returns screenshot.",
		{ window_id: n.optional(), app: z.string().optional() },
		async (p) => { const r = await backend.hsCall("POST", "/focus", p); return actionRes(JSON.stringify(r), 200); }
	);

	server.tool("windows", "List all visible windows with positions", {},
		async () => jsonRes(await backend.hsCall("GET", "/windows")));

	server.tool("apps", "List running applications", {},
		async () => jsonRes(await backend.hsCall("GET", "/apps")));

	server.tool("element_at", "Get UI element info at screen coordinates",
		{ x: n, y: n },
		async (p) => jsonRes(await backend.hsCall("POST", "/element_at", p)));

	server.tool("accessibility_tree", "Get accessibility tree of focused or named app",
		{ app: z.string().optional(), depth: n.optional() },
		async (p) => jsonRes(await backend.hsCall("POST", "/accessibility", p, 30000)));

	server.tool("applescript", "Run AppleScript via osascript.",
		{ code: z.string() },
		async ({ code }) => {
			let r = await backend.runOsascript(code);
			for (let i = 0; i < 3 && r.timedOut; i++) {
				await backend.hsCall("POST", "/type", { key: "return" }, 3000).catch(() => {});
				await new Promise(res => setTimeout(res, 1000));
				r = await backend.runOsascript(code);
				if (!r.timedOut) break;
			}
			return jsonRes(r);
		}
	);

	server.tool("reload_config", "Reload Hammerspoon config", {},
		async () => jsonRes(await backend.hsCall("POST", "/reload")));
}
