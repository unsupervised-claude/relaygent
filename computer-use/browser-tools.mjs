// Browser automation tools via CDP
// Registers browser_navigate, browser_eval, browser_coords, browser_type on an MCP server

import { z } from "zod";
import { hsCall, takeScreenshot } from "./hammerspoon.mjs";
import { cdpEval, cdpNavigate } from "./cdp.mjs";

const jsonRes = (r) => ({ content: [{ type: "text", text: JSON.stringify(r, null, 2) }] });
const actionRes = async (text, delay) => ({ content: [{ type: "text", text }, ...await takeScreenshot(delay ?? 1500)] });

const COORD_EXPR = (sel) =>
  `(function(){var el=document.querySelector(${JSON.stringify(sel)});` +
  `if(!el)return null;var r=el.getBoundingClientRect();` +
  `return JSON.stringify({sx:Math.round(r.left+r.width/2+window.screenX),` +
  `sy:Math.round(r.top+r.height/2+window.screenY+(window.outerHeight-window.innerHeight))})})()`;

const TYPE_EXPR = (sel, text) =>
  `(function(){var el=document.querySelector(${JSON.stringify(sel)});` +
  `if(!el)return 'not found';el.focus();el.value=${JSON.stringify(text)};` +
  `el.dispatchEvent(new Event('input',{bubbles:true}));` +
  `el.dispatchEvent(new Event('change',{bubbles:true}));return el.value})()`;

export function registerBrowserTools(server, IS_LINUX) {
  server.tool("browser_navigate",
    "Navigate browser to a URL via CDP (fast) or keyboard fallback. Auto-returns screenshot.",
    { url: z.string().describe("URL to navigate to"),
      new_tab: z.boolean().optional().describe("Open in new tab") },
    async ({ url, new_tab }) => {
      if (!new_tab && await cdpNavigate(url)) return actionRes(`Navigated to ${url}`, 1500);
      const mod = IS_LINUX ? "ctrl" : "cmd";
      const browser = IS_LINUX ? "google-chrome" : "Google Chrome";
      await hsCall("POST", "/launch", { app: browser });
      await new Promise(r => setTimeout(r, 300));
      await hsCall("POST", "/type", { key: new_tab ? "t" : "l", modifiers: [mod] });
      await new Promise(r => setTimeout(r, 200));
      await hsCall("POST", "/type", { text: url });
      await new Promise(r => setTimeout(r, 100));
      await hsCall("POST", "/type", { key: "return" });
      return actionRes(`Navigated to ${url}`, 1500);
    }
  );

  server.tool("browser_eval",
    "Run JavaScript in Chrome's active tab via CDP. Returns the result value. Use JSON.stringify() for objects.",
    { expression: z.string().describe("JavaScript expression to evaluate") },
    async ({ expression }) => jsonRes({ result: await cdpEval(expression) })
  );

  server.tool("browser_coords",
    "Get screen coordinates {sx, sy} for a CSS selector in Chrome. Use result with click().",
    { selector: z.string().describe("CSS selector (e.g. 'input', 'a.nav-link', '#submit')") },
    async ({ selector }) => {
      const raw = await cdpEval(COORD_EXPR(selector));
      if (!raw) return jsonRes({ error: `Element not found: ${selector}` });
      try { return jsonRes(JSON.parse(raw)); } catch { return jsonRes({ error: "Parse failed", raw }); }
    }
  );

  server.tool("browser_type",
    "Type text into a web input via JS injection (avoids address bar capture). Auto-returns screenshot.",
    { selector: z.string().describe("CSS selector for the input"),
      text: z.string().describe("Text to type") },
    async ({ selector, text }) => {
      const result = await cdpEval(TYPE_EXPR(selector, text));
      if (result === "not found") return jsonRes({ error: `Element not found: ${selector}` });
      return actionRes(`Typed into ${selector}: "${text}"`, 400);
    }
  );
}
