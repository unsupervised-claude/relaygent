// Chrome DevTools Protocol client for browser automation
// Connects to Chrome on CDP_PORT (default 9223) for reliable web content clicks

import http from "node:http";
import { readFileSync, writeFileSync } from "node:fs";

const CDP_PORT = 9223;
const CHROME_PREFS = `${process.env.HOME}/data/chrome-debug-profile/Default/Preferences`;

let _ws = null;
let _msgId = 0;
let _pending = new Map();
let _events = [];  // one-shot CDP event listeners [{method, cb}]
let _currentTabId = null;  // track which tab CDP is connected to

function log(msg) { process.stderr.write(`[cdp] ${msg}\n`); }

const cdpActivate = (tabId) => new Promise(resolve => {
  const req = http.request({ hostname: "localhost", port: CDP_PORT, path: `/json/activate/${tabId}`, timeout: 2000 }, res => {
    res.on("data", () => {}); res.on("end", () => resolve(res.statusCode === 200));
  });
  req.on("error", () => resolve(false)); req.end();
});

const cdpHttp = (path) => new Promise(resolve => {
  const req = http.request({ hostname: "localhost", port: CDP_PORT, path, timeout: 3000 }, res => {
    const chunks = [];
    res.on("data", c => chunks.push(c));
    res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks))); } catch { resolve(null); } });
  });
  req.on("error", () => resolve(null));
  req.on("timeout", () => { req.destroy(); resolve(null); });
  req.end();
});

async function connectTab(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", e => reject(e));
    ws.addEventListener("message", ({ data }) => {
      try {
        const msg = JSON.parse(data);
        if (msg.id && _pending.has(msg.id)) {
          _pending.get(msg.id)(msg);
          _pending.delete(msg.id);
        } else if (msg.method) {
          const idx = _events.findIndex(e => e.method === msg.method);
          if (idx >= 0) { _events.splice(idx, 1)[0].cb(); }
        }
      } catch {}
    });
    ws.addEventListener("close", () => { _ws = null; });
  });
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!_ws || _ws.readyState !== 1) { reject(new Error("CDP not connected")); return; }
    const id = ++_msgId;
    _pending.set(id, resolve);
    _ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { _pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
  });
}

function waitForEvent(method, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { _events = _events.filter(e => e !== entry); reject(new Error(`Event timeout: ${method}`)); }, timeoutMs);
    const entry = { method, cb: () => { clearTimeout(timer); resolve(); } };
    _events.push(entry);
  });
}

export async function getConnection() {
  if (_ws && _ws.readyState === 1) {
    try {
      const r = await Promise.race([
        send("Runtime.evaluate", { expression: "1", returnByValue: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("health timeout")), 2000)),
      ]);
      if (r?.result?.result?.value === 1) return { ws: _ws };
    } catch {}
    log("health check failed, reconnecting");
    try { _ws.close(); } catch {} _ws = null;
  }
  const tabs = await cdpHttp("/json/list");
  if (!tabs) return null;
  const pages = tabs.filter(t => t.type === "page" && t.webSocketDebuggerUrl);
  if (!pages.length) return null;
  const page = pages.find(t => t.id === _currentTabId)
    ?? pages.find(t => /^https?:/.test(t.url)) ?? pages[0];
  try {
    _ws = await connectTab(page.webSocketDebuggerUrl);
    _currentTabId = page.id;
    log(`connected to ${page.url.substring(0, 60)}`);
    return { ws: _ws };
  } catch (e) { log(`connect failed: ${e.message}`); return null; }
}

export async function cdpClick(x, y) {
  const conn = await getConnection();
  if (!conn) return false;
  try {
    const posResult = await send("Runtime.evaluate", {
      expression: "JSON.stringify({x:window.screenX,y:window.screenY,ch:window.outerHeight-window.innerHeight})",
      returnByValue: true,
    });
    const pos = JSON.parse(posResult?.result?.result?.value || "{}");
    const vx = Math.round(x - (pos.x || 0)), vy = Math.round(y - (pos.y || 0) - (pos.ch || 87));
    log(`click screen(${x},${y}) → viewport(${vx},${vy})`);
    for (const type of ["mousePressed", "mouseReleased"])
      await send("Input.dispatchMouseEvent", { type, x: vx, y: vy, button: "left", clickCount: 1 });
    return true;
  } catch (e) { log(`click error: ${e.message}`); _ws = null; return false; }
}

async function _eval(expression, awaitPromise = false) {
  const conn = await getConnection();
  if (!conn) return null;
  try {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
    return result?.result?.result?.value ?? null;
  } catch (e) { log(`eval error: ${e.message}`); _ws = null; return null; }
}
export const cdpEval = (expr) => _eval(expr);
export const cdpEvalAsync = (expr) => _eval(expr, true);

export async function cdpNavigate(url) {
  const conn = await getConnection();
  if (!conn) return false;
  try {
    await send("Page.enable");
    const loaded = waitForEvent("Page.loadEventFired", 15000);
    await send("Page.navigate", { url });
    await loaded;
    return true;
  } catch (e) {
    log(`navigate error: ${e.message}`);
    return false;
  }
}

/** Disconnect cached CDP WebSocket so next getConnection() re-queries /json/list */
export function cdpDisconnect() {
  if (_ws) { try { _ws.close(); } catch {} _ws = null; }
  _currentTabId = null;
}

/** After keyboard navigation, find and activate the tab Chrome just loaded. */
export async function cdpSyncToVisibleTab(url) {
  cdpDisconnect();
  await new Promise(r => setTimeout(r, 800));
  const tabs = await cdpHttp("/json/list");
  if (!tabs) return;
  const pages = tabs.filter(t => t.type === "page" && t.webSocketDebuggerUrl);
  const target = pages.find(t => t.url === url || t.url.startsWith(url.replace(/\/$/, "")))
    ?? pages.find(t => /^https?:/.test(t.url)) ?? pages[0];
  if (!target) return;
  _currentTabId = target.id;
  await cdpActivate(target.id);
  log(`synced to tab: ${target.url.substring(0, 60)}`);
}

/** Reset Chrome profile exit_type to Normal so next launch skips "Restore pages?" bubble */
export function patchChromePrefs() {
  try {
    const prefs = JSON.parse(readFileSync(CHROME_PREFS, "utf8"));
    prefs.profile = { ...prefs.profile, exit_type: "Normal", exited_cleanly: true };
    writeFileSync(CHROME_PREFS, JSON.stringify(prefs));
    log("patched Chrome prefs: exit_type=Normal");
  } catch (e) { log(`patchChromePrefs failed: ${e.message}`); }
}

export async function cdpAvailable() {
  const tabs = await cdpHttp("/json/list");
  return tabs !== null && Array.isArray(tabs);
}
