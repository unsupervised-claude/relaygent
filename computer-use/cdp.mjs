// Chrome DevTools Protocol client for browser automation
// Connects to Chrome on CDP_PORT (default 9223) for reliable web content clicks

import http from "node:http";

const CDP_PORT = 9223;

let _ws = null;
let _msgId = 0;
let _pending = new Map();

function log(msg) { process.stderr.write(`[cdp] ${msg}\n`); }

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

export async function getConnection() {
  if (_ws && _ws.readyState === 1) return { ws: _ws };
  const tabs = await cdpHttp("/json/list");
  if (!tabs) return null;
  const page = tabs.find(t => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) return null;
  try {
    _ws = await connectTab(page.webSocketDebuggerUrl);
    log(`connected to ${page.url.substring(0, 60)}`);
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
    await send("Page.navigate", { url });
    return true;
  } catch (e) {
    log(`navigate error: ${e.message}`);
    return false;
  }
}

export async function cdpAvailable() {
  const tabs = await cdpHttp("/json/list");
  return tabs !== null && Array.isArray(tabs);
}
