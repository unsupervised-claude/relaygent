// Browser automation tools via CDP
// Registers browser_navigate, browser_eval, browser_coords, browser_type on an MCP server

import { z } from "zod";
import { hsCall, takeScreenshot } from "./hammerspoon.mjs";
import { cdpEval, cdpEvalAsync, cdpNavigate, cdpClick } from "./cdp.mjs";

const jsonRes = (r) => ({ content: [{ type: "text", text: JSON.stringify(r, null, 2) }] });
const actionRes = async (text, delay) => ({ content: [{ type: "text", text }, ...await takeScreenshot(delay ?? 1500)] });

const COORD_EXPR = (sel) =>
  `(function(){var el=document.querySelector(${JSON.stringify(sel)});` +
  `if(!el)return null;var r=el.getBoundingClientRect();` +
  `return JSON.stringify({sx:Math.round(r.left+r.width/2+window.screenX),` +
  `sy:Math.round(r.top+r.height/2+window.screenY+(window.outerHeight-window.innerHeight))})})()`;

const CLICK_EXPR = (sel) =>
  `(function(){var el=document.querySelector(${JSON.stringify(sel)});` +
  `if(!el)return null;el.click();var r=el.getBoundingClientRect();` +
  `return JSON.stringify({sx:Math.round(r.left+r.width/2+window.screenX),` +
  `sy:Math.round(r.top+r.height/2+window.screenY+(window.outerHeight-window.innerHeight))})})()`;

const TEXT_COORD_EXPR = (text, idx) =>
  `(function(){var t=${JSON.stringify(text.toLowerCase())},i=${idx};` +
  `var els=Array.from(document.querySelectorAll('a,button,input[type=submit],input[type=button],[role=button]'));` +
  `var matches=els.filter(e=>e.offsetParent!==null&&(e.innerText||e.value||'').toLowerCase().includes(t));` +
  `var el=matches[i];if(!el)return JSON.stringify({error:'No match',count:matches.length});` +
  `var r=el.getBoundingClientRect();` +
  `return JSON.stringify({sx:Math.round(r.left+r.width/2+window.screenX),` +
  `sy:Math.round(r.top+r.height/2+window.screenY+(window.outerHeight-window.innerHeight)),` +
  `text:(el.innerText||el.value||'').trim().substring(0,50),count:matches.length})})()`;

const TEXT_CLICK_EXPR = (text, idx) =>
  `(function(){var t=${JSON.stringify(text.toLowerCase())},i=${idx};` +
  `var els=Array.from(document.querySelectorAll('a,button,input[type=submit],input[type=button],[role=button]'));` +
  `var matches=els.filter(e=>e.offsetParent!==null&&(e.innerText||e.value||'').toLowerCase().includes(t));` +
  `var el=matches[i];if(!el)return JSON.stringify({error:'No match',count:matches.length});` +
  `el.click();var r=el.getBoundingClientRect();` +
  `return JSON.stringify({sx:Math.round(r.left+r.width/2+window.screenX),` +
  `sy:Math.round(r.top+r.height/2+window.screenY+(window.outerHeight-window.innerHeight)),` +
  `text:(el.innerText||el.value||'').trim().substring(0,50),count:matches.length})})()`;

const TYPE_EXPR = (sel, text) =>
  `(function(){var el=document.querySelector(${JSON.stringify(sel)});` +
  `if(!el)return 'not found';el.focus();el.value=${JSON.stringify(text)};` +
  `el.dispatchEvent(new Event('input',{bubbles:true}));` +
  `el.dispatchEvent(new Event('change',{bubbles:true}));return el.value})()`;

const WAIT_EXPR = (sel, timeoutMs) =>
  `(function(){return new Promise((res,rej)=>{` +
  `var t=Date.now(),limit=${timeoutMs};` +
  `(function poll(){var el=document.querySelector(${JSON.stringify(sel)});` +
  `if(el&&el.offsetParent!==null)return res('found');` +
  `if(Date.now()-t>limit)return rej('timeout');` +
  `setTimeout(poll,100)})()})})()`;

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

  server.tool("browser_click",
    "Click a web element by CSS selector — finds coords and clicks via CDP in one step. Auto-returns screenshot.",
    { selector: z.string().describe("CSS selector (e.g. 'button[type=submit]', 'a.nav-link', '#login')") },
    async ({ selector }) => {
      const raw = await cdpEval(CLICK_EXPR(selector));
      if (!raw) return jsonRes({ error: `Element not found: ${selector}` });
      let coords;
      try { coords = JSON.parse(raw); } catch { return jsonRes({ error: "Parse failed", raw }); }
      return actionRes(`Clicked ${selector} at (${coords.sx},${coords.sy})`, 400);
    }
  );

  server.tool("browser_click_text",
    "Click a visible element by its text content (links, buttons). Safer than browser_click when multiple elements share a selector. Auto-returns screenshot.",
    { text: z.string().describe("Text to search for (case-insensitive contains match)"),
      index: z.coerce.number().optional().describe("Which match to click if multiple (default: 0)") },
    async ({ text, index = 0 }) => {
      const raw = await cdpEval(TEXT_CLICK_EXPR(text, index));
      if (!raw) return jsonRes({ error: `No elements found containing: ${text}` });
      let coords;
      try { coords = JSON.parse(raw); } catch { return jsonRes({ error: "Parse failed", raw }); }
      if (coords.error) return jsonRes(coords);
      return actionRes(`Clicked "${coords.text}" at (${coords.sx},${coords.sy}) [${coords.count} matches]`, 400);
    }
  );

  server.tool("browser_scroll",
    "Scroll within the web page by pixels (not screen scroll). Use for long pages. Auto-returns screenshot.",
    { x: z.coerce.number().optional().describe("Horizontal scroll pixels (default: 0)"),
      y: z.coerce.number().optional().describe("Vertical scroll pixels (default: 300, negative = up)"),
      selector: z.string().optional().describe("Scroll inside this element (default: window)") },
    async ({ x = 0, y = 300, selector }) => {
      const expr = selector
        ? `(function(){var el=document.querySelector(${JSON.stringify(selector)});if(el)el.scrollBy(${x},${y});return !!el})()`
        : `window.scrollBy(${x},${y});true`;
      await cdpEval(expr);
      return actionRes(`Scrolled (${x},${y})${selector ? ` in ${selector}` : ""}`, 300);
    }
  );

  server.tool("browser_wait",
    "Wait for a CSS selector to appear in the page (polls up to timeout). Returns 'found' or 'timeout'.",
    { selector: z.string().describe("CSS selector to wait for"),
      timeout: z.coerce.number().optional().describe("Max wait ms, max 8000 (default: 5000)") },
    async ({ selector, timeout = 5000 }) => {
      const capped = Math.min(timeout, 8000);
      const expr = WAIT_EXPR(selector, capped);
      try {
        const result = await cdpEvalAsync(expr);
        return jsonRes({ status: result ?? "timeout", selector });
      } catch {
        return jsonRes({ status: "timeout", selector });
      }
    }
  );
}
