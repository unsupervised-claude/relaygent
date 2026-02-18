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

    // Look up channel name
    let channelName = channelId;
    try {
      const info = await web.conversations.info({ channel: channelId });
      channelName = info.channel?.name || info.channel?.id || channelId;
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

  client.on("connected", () => {
    log("Socket Mode connected");
    // Write empty cache to signal we're alive
    writeCache(readCache());
  });

  client.on("disconnected", () => {
    log("Socket Mode disconnected — will auto-reconnect");
  });

  await client.start();
  log("Slack Socket Mode listener started");
}

start().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
