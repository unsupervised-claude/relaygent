// Chrome DevTools Protocol client for browser automation
// Connects to Chrome on CDP_PORT (default 9223) for reliable web content clicks

import http from "node:http";

const CDP_PORT = 9223;

let _ws = null;
let _msgId = 0;
let _pending = new Map();
let _events = [];  // one-shot CDP event listeners [{method, cb}]

function log(msg) { process.stderr.write(`[cdp] ${msg}\n`); }

/** Activate a tab via Chrome HTTP endpoint — actually switches visible tab (unlike Page.bringToFront) */
async function cdpActivate(tabId) {
  return new Promise(resolve => {
    const req = http.request({ hostname: "localhost", port: CDP_PORT, path: `/json/activate/${tabId}`, timeout: 2000 }, res => {
      res.on("data", () => {}); res.on("end", () => resolve(res.statusCode === 200));
    });
    req.on("error", () => resolve(false));
    req.end();
  });
}

async function cdpHttp(path) {
  return new Promise(resolve => {
    const req = http.request({ hostname: "localhost", port: CDP_PORT, path, timeout: 3000 }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks))); } catch { resolve(null); } });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.end();
  });
}

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
    // Health check: verify connection is alive (catches stale connections after Chrome crash)
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
  // Prefer http/https pages over chrome:// internal pages (e.g. omnibox popup)
  const page = tabs.find(t => t.type === "page" && t.webSocketDebuggerUrl && /^https?:/.test(t.url))
    ?? tabs.find(t => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) return null;
  try {
    _ws = await connectTab(page.webSocketDebuggerUrl);
    log(`connected to ${page.url.substring(0, 60)}`);
    await cdpActivate(page.id);  // switch visible tab so screenshots match CDP tab
    return { ws: _ws };
  } catch (e) {
    log(`connect failed: ${e.message}`);
    return null;
  }
}

/**
 * Click at screen (x, y) via Input.dispatchMouseEvent.
 * Converts screen coords → viewport coords using window.screenX/Y.
 * Returns true on success, false if CDP unavailable.
 */
export async function cdpClick(x, y) {
  const conn = await getConnection();
  if (!conn) return false;
  try {
    const posResult = await send("Runtime.evaluate", {
      expression: "JSON.stringify({x:window.screenX,y:window.screenY,ch:window.outerHeight-window.innerHeight})",
      returnByValue: true,
    });
    const pos = JSON.parse(posResult?.result?.result?.value || "{}");
    const vx = Math.round(x - (pos.x || 0));
    const vy = Math.round(y - (pos.y || 0) - (pos.ch || 87));
    log(`click screen(${x},${y}) → viewport(${vx},${vy})`);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await send("Input.dispatchMouseEvent", { type, x: vx, y: vy, button: "left", clickCount: 1 });
    }
    return true;
  } catch (e) {
    log(`click error: ${e.message}`);
    _ws = null;
    return false;
  }
}

/**
 * Like cdpEval but waits for Promises to resolve (awaitPromise: true).
 * Required for expressions that return a Promise (e.g. polling loops).
 * Note: CDP send has a 10s hard timeout — keep polling expressions under that.
 */
export async function cdpEvalAsync(expression) {
  const conn = await getConnection();
  if (!conn) return null;
  try {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return result?.result?.result?.value ?? null;
  } catch (e) {
    log(`evalAsync error: ${e.message}`);
    _ws = null;
    return null;
  }
}

export async function cdpEval(expression) {
  const conn = await getConnection();
  if (!conn) return null;
  try {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true });
    return result?.result?.result?.value ?? null;
  } catch (e) {
    log(`eval error: ${e.message}`);
    _ws = null;
    return null;
  }
}

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
}

export async function cdpAvailable() {
  const tabs = await cdpHttp("/json/list");
  return tabs !== null && Array.isArray(tabs);
}
