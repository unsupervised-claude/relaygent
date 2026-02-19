#!/usr/bin/env node
/**
 * Slack Socket Mode listener — real-time message delivery via WebSocket.
 *
 * Connects to Slack using an app-level token, receives message events,
 * and writes them to a cache file for the notification poller to read.
 *
 * Usage: node slack-socket-listener.mjs
 *
 * Requires:
 *   ~/.relaygent/slack/app-token   — xapp-* app-level token
 *   ~/.relaygent/slack/token.json  — {"access_token": "xoxp-*"} user token
 */

import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import fs from "fs";
import path from "path";
import os from "os";

const APP_TOKEN_PATH = path.join(os.homedir(), ".relaygent", "slack", "app-token");
const USER_TOKEN_PATH = path.join(os.homedir(), ".relaygent", "slack", "token.json");
const CACHE_FILE = "/tmp/relaygent-slack-socket-cache.json";
const LAST_ACK_FILE = path.join(os.homedir(), ".relaygent", "slack", ".last_check_ts");
const MAX_MESSAGES = 50;

function loadAppToken() {
  return fs.readFileSync(APP_TOKEN_PATH, "utf-8").trim();
}

function loadUserToken() {
  const data = JSON.parse(fs.readFileSync(USER_TOKEN_PATH, "utf-8"));
  return data.access_token;
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
  } catch {
    return { messages: [], updated: 0 };
  }
}

function writeCache(data) {
  data.updated = Date.now();
  const tmp = CACHE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, CACHE_FILE);
}

function getLastAckTs() {
  try {
    return parseFloat(fs.readFileSync(LAST_ACK_FILE, "utf-8").trim()) || 0;
  } catch {
    return 0;
  }
}

function log(msg) {
  const ts = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  console.log(`[${ts}] ${msg}`);
}

let selfUid = null;

async function backfill(web) {
  const cache = readCache();
  const lastAck = getLastAckTs();
  const msgs = cache.messages || [];
  const lastCachedTs = msgs.length ? Math.max(...msgs.map(m => parseFloat(m.ts || "0"))) : 0;
  const oldest = Math.max(lastAck, lastCachedTs);
  if (!oldest) return;

  // Only fetch DMs and the most active channels (limit API calls)
  const channelRes = await web.conversations.list({
    types: "im,mpim", exclude_archived: true, limit: 20,
  });
  const channels = (channelRes.channels || []).filter(c => c.is_member).slice(0, 5);
  let added = 0;
  const skipSubtypes = new Set(["channel_join","bot_message","message_changed","message_deleted"]);
  for (const ch of channels) {
    try {
      const hist = await web.conversations.history({ channel: ch.id, oldest: String(oldest), limit: 5 });
      for (const m of (hist.messages || []).reverse()) {
        if (m.user === selfUid) continue;
        if (parseFloat(m.ts) <= oldest) continue;
        if (msgs.find(x => x.ts === m.ts)) continue;
        if (m.subtype && skipSubtypes.has(m.subtype)) continue;
        const channelName = ch.name || ch.id;
        msgs.push({ channel: ch.id, channel_name: channelName,
          user: m.user || "", text: (m.text || "").slice(0, 500), ts: m.ts, received: Date.now() });
        added++;
      }
      await new Promise(r => setTimeout(r, 500)); // rate limit: 2 req/sec
    } catch { /* skip */ }
  }
  if (added > 0) {
    cache.messages = msgs.slice(-MAX_MESSAGES);
    writeCache(cache);
    log(`Backfilled ${added} missed DM message(s)`);
  }
}

async function start() {
  const appToken = loadAppToken();
  const userToken = loadUserToken();
  const web = new WebClient(userToken);

  // Get our own user ID to filter self-messages
  try {
    const auth = await web.auth.test();
    selfUid = auth.user_id;
    log(`Authenticated as ${auth.user} (${selfUid})`);
  } catch (e) {
    log(`Warning: auth.test failed: ${e.message}`);
  }

  const client = new SocketModeClient({ appToken });

  client.on("message", async ({ event, body, ack }) => {
    await ack();
    if (!event) return;

    // Skip our own messages
    if (event.user === selfUid) return;
    // Skip bot messages and subtypes we don't care about
    const skipSubtypes = new Set([
      "channel_join", "joiner_notification_for_inviter",
      "bot_message", "message_changed", "message_deleted",
    ]);
    if (event.subtype && skipSubtypes.has(event.subtype)) return;

    const lastAck = getLastAckTs();
    const msgTs = parseFloat(event.ts || "0");
    // Skip messages older than last ack
    if (msgTs <= lastAck) return;

    const channelId = event.channel || body?.event?.channel;
    if (!channelId) return;

    // Look up channel name (resolve DMs to user display names)
    let channelName = channelId;
    try {
      const info = await web.conversations.info({ channel: channelId });
      const ch = info.channel;
      if (ch?.is_im && ch?.user) {
        try {
          const u = await web.users.info({ user: ch.user });
          channelName = `DM: ${u.user?.real_name || u.user?.name || ch.user}`;
        } catch { channelName = `DM: ${ch.user}`; }
      } else {
        channelName = ch?.name || ch?.id || channelId;
      }
    } catch { /* use ID as fallback */ }

    const cache = readCache();
    cache.messages.push({
      channel: channelId,
      channel_name: channelName,
      user: event.user || "",
      text: (event.text || "").slice(0, 500),
      ts: event.ts,
      received: Date.now(),
    });

    // Trim to max size
    if (cache.messages.length > MAX_MESSAGES) {
      cache.messages = cache.messages.slice(-MAX_MESSAGES);
    }
    writeCache(cache);
    log(`Message in #${channelName} from ${event.user}: ${(event.text || "").slice(0, 80)}`);
  });

  client.on("connected", async () => {
    log("Socket Mode connected");
    // Write cache to signal we're alive, then backfill missed messages
    writeCache(readCache());
    try {
      await backfill(web);
    } catch (e) {
      log(`Backfill error: ${e.message}`);
    }
  });

  client.on("disconnected", () => {
    log("Socket Mode disconnected — will auto-reconnect");
  });

  // Heartbeat: touch cache every 5min so stale-detection doesn't kill a healthy connection
  setInterval(() => writeCache(readCache()), 5 * 60 * 1000);

  await client.start();
  log("Slack Socket Mode listener started");
}

start().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
