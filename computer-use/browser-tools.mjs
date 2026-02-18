// Browser automation tools via CDP
// Registers browser_navigate, browser_eval, browser_coords, browser_type on an MCP server

import { z } from "zod";
import { hsCall, takeScreenshot } from "./hammerspoon.mjs";
import { cdpEval, cdpEvalAsync, cdpNavigate, cdpClick } from "./cdp.mjs";

const jsonRes = (r) => ({ content: [{ type: "text", text: JSON.stringify(r, null, 2) }] });
const actionRes = async (text, delay) => ({ content: [{ type: "text", text }, ...await takeScreenshot(delay ?? 1500)] });
// Claude sometimes serializes booleans as strings ("true"/"false") — coerce safely
const bool = z.preprocess(v => v === "true" ? true : v === "false" ? false : v, z.boolean().optional());

// Deep query helpers — traverse shadow DOMs so browser tools can reach web component internals
const _deep = `function _dqa(s,r){r=r||document;var o=Array.from(r.querySelectorAll(s));` +
  `r.querySelectorAll('*').forEach(function(e){if(e.shadowRoot)o=o.concat(_dqa(s,e.shadowRoot))});return o}` +
  `function _dq(s,r){r=r||document;var e=r.querySelector(s);if(e)return e;` +
  `var a=r.querySelectorAll('*');for(var i=0;i<a.length;i++){if(a[i].shadowRoot){e=_dq(s,a[i].shadowRoot);if(e)return e}}return null}`;

// Prefer first visible element matching selector (skip hidden 0x0 elements); no fallback to hidden
const _vis = `var a=_dqa(S);` +
  `var el=a.find(function(e){return e.offsetParent!==null&&e.getBoundingClientRect().width>0});`;
const _coords = `var r=el.getBoundingClientRect();` +
  `return JSON.stringify({sx:Math.round(r.left+r.width/2+window.screenX),` +
  `sy:Math.round(r.top+r.height/2+window.screenY+(window.outerHeight-window.innerHeight))})`;

const COORD_EXPR = (sel) =>
  `(function(){${_deep}var S=${JSON.stringify(sel)};${_vis}if(!el)return null;${_coords}})()`;

const CLICK_EXPR = (sel) =>
  `(function(){${_deep}var S=${JSON.stringify(sel)};${_vis}if(!el)return null;el.click();${_coords}})()`;

// Normalize nbsp + curly quotes for text matching
const _norm = `var norm=s=>s.replace(/[\\u00a0]/g,' ').replace(/[\\u2018\\u2019]/g,"'").replace(/[\\u201c\\u201d]/g,'"').toLowerCase()`;
const _textSel = `'a,button,input[type=submit],input[type=button],[role=button]'`;

// Exact match preferred over substring match for text-based element finding
const TEXT_MATCH_EXPR = (text, idx, click) =>
  `(function(){${_deep}${_norm};var t=norm(${JSON.stringify(text)}),i=${idx};` +
  `var els=_dqa(${_textSel}).filter(function(e){return e.offsetParent!==null});` +
  `var exact=els.filter(function(e){return norm(e.innerText||e.value||'').trim()===t});` +
  `var matches=exact.length?exact:els.filter(function(e){return norm(e.innerText||e.value||'').includes(t)});` +
  `var el=matches[i];if(!el)return JSON.stringify({error:'No match',count:matches.length});` +
  (click ? `el.click();` : ``) +
  `var r=el.getBoundingClientRect();` +
  `return JSON.stringify({sx:Math.round(r.left+r.width/2+window.screenX),` +
  `sy:Math.round(r.top+r.height/2+window.screenY+(window.outerHeight-window.innerHeight)),` +
  `text:(el.innerText||el.value||'').trim().substring(0,50),count:matches.length})})()`;

const TEXT_COORD_EXPR = (text, idx) => TEXT_MATCH_EXPR(text, idx, false);
const TEXT_CLICK_EXPR = (text, idx) => TEXT_MATCH_EXPR(text, idx, true);

const TYPE_EXPR = (sel, text, submit) =>
  `(function(){${_deep}var el=_dq(${JSON.stringify(sel)});` +
  `if(!el)return 'not found';el.focus();el.value=${JSON.stringify(text)};` +
  `el.dispatchEvent(new Event('input',{bubbles:true}));` +
  `el.dispatchEvent(new Event('change',{bubbles:true}));` +
  (submit ? `el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,bubbles:true}));` +
  `var f=el.closest('form');if(f)f.submit();` : ``) +
  `return el.value})()`;

// Keystroke mode: types char-by-char with full key events (for autocomplete/typeahead inputs)
const TYPE_SLOW_EXPR = (sel, text, submit) =>
  `(function(){${_deep}var el=_dq(${JSON.stringify(sel)});` +
  `if(!el)return Promise.resolve('not found');el.focus();el.value='';` +
  `var t=${JSON.stringify(text)};` +
  `return new Promise(function(res){var i=0;(function next(){if(i>=t.length){` +
  (submit ? `el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,bubbles:true}));` +
  `var f=el.closest('form');if(f)f.submit();` : ``) +
  `return res(el.value)}var c=t[i++];el.value+=c;` +
  `el.dispatchEvent(new KeyboardEvent('keydown',{key:c,bubbles:true}));` +
  `el.dispatchEvent(new KeyboardEvent('keypress',{key:c,bubbles:true}));` +
  `el.dispatchEvent(new Event('input',{bubbles:true}));` +
  `el.dispatchEvent(new KeyboardEvent('keyup',{key:c,bubbles:true}));` +
  `setTimeout(next,20)})()})})()`;

const WAIT_EXPR = (sel, timeoutMs) =>
  `(function(){${_deep}return new Promise(function(res,rej){` +
  `var t=Date.now(),limit=${timeoutMs};` +
  `(function poll(){var el=_dq(${JSON.stringify(sel)});` +
  `if(el&&el.offsetParent!==null)return res('found');` +
  `if(Date.now()-t>limit)return rej('timeout');` +
  `setTimeout(poll,100)})()})})()`;

export function registerBrowserTools(server, IS_LINUX) {
  server.tool("browser_navigate",
    "Navigate browser to a URL via CDP (fast) or keyboard fallback. Auto-returns screenshot.",
    { url: z.string().describe("URL to navigate to"),
      new_tab: bool.describe("Open in new tab") },
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
      text: z.string().describe("Text to type"),
      submit: bool.describe("Submit form after typing (dispatches Enter + form.submit())"),
      slow: bool.describe("Type char-by-char with key events (for autocomplete/typeahead inputs)") },
    async ({ selector, text, submit, slow }) => {
      const expr = slow ? TYPE_SLOW_EXPR(selector, text, submit) : TYPE_EXPR(selector, text, submit);
      const result = slow ? await cdpEvalAsync(expr) : await cdpEval(expr);
      if (result === "not found") return jsonRes({ error: `Element not found: ${selector}` });
      return actionRes(`Typed into ${selector}: "${text}"${slow ? " (slow)" : ""}${submit ? " (submitted)" : ""}`, submit ? 1500 : 400);
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
        ? `(function(){${_deep}var el=_dq(${JSON.stringify(selector)});if(el)el.scrollBy(${x},${y});return !!el})()`
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
