#!/usr/bin/env node
// Slack MCP server — channels, messages, reactions, users (xoxp- user tokens)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { slackApi } from "./slack-client.mjs";
import { userName, dmName, formatText } from "./slack-helpers.mjs";

const SOCKET_CACHE = "/tmp/relaygent-slack-socket-cache.json";
const LAST_ACK = join(homedir(), ".relaygent", "slack", ".last_check_ts");

const server = new McpServer({ name: "slack", version: "1.0.0" });
const txt = (t) => ({ content: [{ type: "text", text: t }] });
function ackSlack() {
	try { mkdirSync(dirname(LAST_ACK), { recursive: true }); writeFileSync(LAST_ACK, `${Date.now() / 1000}`); } catch {}
}

server.tool("channels", "List Slack channels the user has joined.",
	{ limit: z.number().default(100).describe("Max channels to return"),
	  types: z.string().default("public_channel,private_channel,mpim,im").describe("Channel types") },
	async ({ limit, types }) => {
		try {
			const { channels = [] } = await slackApi("conversations.list", { limit, types, exclude_archived: true });
			const lines = await Promise.all(channels.map(async c =>
				`${await dmName(c)} (${c.id})${c.is_im || c.is_mpim ? "" : ` — ${c.num_members || 0} members`}${c.topic?.value ? ` — ${c.topic.value}` : ""}`
			));
			return txt(lines.length ? lines.join("\n") : "No channels found.");
		} catch (e) { return txt(`Slack channels error: ${e.message}`); }
	}
);

server.tool("read_messages",
	"Read recent messages from a Slack channel.",
	{ channel: z.string().describe("Channel ID (e.g. C0123456789)"),
	  limit: z.number().default(20).describe("Number of messages"),
	  thread_ts: z.string().optional().describe("Thread timestamp to read replies in a thread") },
	async ({ channel, limit, thread_ts }) => {
		try {
			const data = thread_ts
				? await slackApi("conversations.replies", { channel, ts: thread_ts, limit })
				: await slackApi("conversations.history", { channel, limit });
			const msgs = data.messages || [];
			if (!msgs.length) return txt("No messages.");
			if (!thread_ts) msgs.reverse();
			const lines = await Promise.all(msgs.map(async m => {
				const ts = new Date(parseFloat(m.ts) * 1000)
					.toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
				const user = await userName(m.user || m.bot_id);
				const replies = m.reply_count ? ` [${m.reply_count} replies, thread_ts: ${m.ts}]` : "";
				return `[${ts}] <${user}> ${await formatText(m.text)}${replies}`;
			}));
			ackSlack();
			return txt(lines.join("\n"));
		} catch (e) { return txt(`Slack read error: ${e.message}`); }
	}
);

server.tool("send_message",
	"Send a message to a Slack channel.",
	{ channel: z.string().describe("Channel ID"),
	  text: z.string().describe("Message text (supports Slack markdown)"),
	  thread_ts: z.string().optional().describe("Thread timestamp to reply in a thread") },
	async ({ channel, text, thread_ts }) => {
		try {
			const params = { channel, text };
			if (thread_ts) params.thread_ts = thread_ts;
			const data = await slackApi("chat.postMessage", params);
			return txt(`Sent to ${channel} (ts: ${data.ts})`);
		} catch (e) { return txt(`Slack send error: ${e.message}`); }
	}
);

server.tool("react",
	"Add an emoji reaction to a message.",
	{ channel: z.string().describe("Channel ID"),
	  timestamp: z.string().describe("Message timestamp (ts)"),
	  name: z.string().describe("Emoji name without colons (e.g. thumbsup)") },
	async ({ channel, timestamp, name }) => {
		try {
			await slackApi("reactions.add", { channel, timestamp, name });
			return txt(`Reacted :${name}: to message ${timestamp}`);
		} catch (e) { return txt(`Slack react error: ${e.message}`); }
	}
);

server.tool("users", "List users in the Slack workspace.",
	{ limit: z.number().default(100).describe("Max users to return") },
	async ({ limit }) => {
		try {
			const { members = [] } = await slackApi("users.list", { limit });
			const lines = members.filter(u => !u.deleted && !u.is_bot && u.id !== "USLACKBOT")
				.map(u => `${u.real_name || u.name} (@${u.name}, ${u.id})${u.profile?.status_text ? ` — ${u.profile.status_text}` : ""}`);
			return txt(lines.length ? lines.join("\n") : "No users found.");
		} catch (e) { return txt(`Slack users error: ${e.message}`); }
	}
);

server.tool("channel_info",
	"Get details about a specific channel.",
	{ channel: z.string().describe("Channel ID") },
	async ({ channel }) => {
		try {
			const data = await slackApi("conversations.info", { channel });
			const c = data.channel;
			const label = await dmName(c);
			const type = c.is_im ? "DM" : c.is_mpim ? "Group DM" : c.is_private ? "Private" : "Public";
			const lines = [`Name: ${label}`, `ID: ${c.id}`, `Type: ${type}`,
				...(!c.is_im ? [`Topic: ${c.topic?.value || "(none)"}`, `Purpose: ${c.purpose?.value || "(none)"}`] : []),
				`Members: ${c.num_members || (c.is_im ? 2 : 0)}`,
				`Created: ${new Date(c.created * 1000).toISOString()}`,
				...(!c.is_im ? [`Archived: ${c.is_archived}`] : []),
			];
			return txt(lines.join("\n"));
		} catch (e) { return txt(`Slack channel_info error: ${e.message}`); }
	}
);

server.tool("search_messages",
	"Search messages across the workspace.",
	{ query: z.string().describe("Search query"),
	  count: z.number().default(10).describe("Max results") },
	async ({ query, count }) => {
		try {
			const data = await slackApi("search.messages", { query, count, sort: "timestamp", sort_dir: "desc" });
			const matches = data.messages?.matches || [];
			if (!matches.length) return txt("No messages found.");
			const lines = await Promise.all(matches.map(async m => {
				const ch = m.channel?.name || m.channel?.id || "?";
				const ts = m.ts ? new Date(parseFloat(m.ts) * 1000)
					.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }) : "";
				return `[${ts}] [#${ch}] <${m.username || m.user}> ${await formatText(m.text)}`;
			}));
			return txt(lines.join("\n\n"));
		} catch (e) { return txt(`Slack search error: ${e.message}`); }
	}
);

server.tool("unread", "Check channels with unread messages.", {},
	async () => {
		try {
			if (existsSync(SOCKET_CACHE)) {
				let ackTs = 0;
				try { ackTs = parseFloat(readFileSync(LAST_ACK, "utf-8").trim()) || 0; } catch {}
				const sock = JSON.parse(readFileSync(SOCKET_CACHE, "utf-8"));
				const msgs = (sock.messages || []).filter(m => parseFloat(m.ts || "0") > ackTs);
				if (msgs.length > 0) {
					const lines = await Promise.all(msgs.map(async m => {
						const ts = new Date(parseFloat(m.ts) * 1000)
							.toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
						const user = await userName(m.user);
						const ch = m.channel_name || m.channel || "?";
						const cid = m.channel ? ` (${m.channel})` : "";
						return `[${ts}] [#${ch}${cid}] <${user}> ${await formatText(m.text)}`;
					}));
					ackSlack();
					return txt(lines.join("\n"));
				}
				return txt("No unread messages.");
			}
			const data = await slackApi("conversations.list", {
				limit: 100, types: "public_channel,private_channel,mpim,im", exclude_archived: true,
			});
			const chs = (data.channels || []).slice(0, 15);
			if (!chs.length) return txt("No channels found.");
			const unread = (await Promise.all(chs.map(async c => {
				try {
					const info = await slackApi("conversations.info", { channel: c.id });
					if (info.channel.unread_count_display > 0)
						return `${await dmName(info.channel)}: ${info.channel.unread_count_display} unread`;
				} catch {}
				return null;
			}))).filter(Boolean);
			return txt(unread.length ? unread.join("\n") : "No unread messages.");
		} catch (e) { return txt(`Slack unread error: ${e.message}`); }
	}
);

server.tool("dm", "Find a DM channel ID by user name (for use with send_message).",
	{ name: z.string().describe("User display name or @handle") },
	async ({ name }) => {
		try {
			const q = name.replace(/^@/, "").toLowerCase();
			const { channels = [] } = await slackApi("conversations.list", { types: "im,mpim", exclude_archived: true, limit: 100 });
			const resolved = await Promise.all(channels.map(async c => ({ id: c.id, label: await dmName(c) })));
			const match = resolved.filter(r => r.label.toLowerCase().includes(q));
			return txt(match.length ? match.map(r => `${r.label}: ${r.id}`).join("\n") : `No DM found for "${name}"`);
		} catch (e) { return txt(`Slack dm error: ${e.message}`); }
	}
);

const transport = new StdioServerTransport();
await server.connect(transport);
