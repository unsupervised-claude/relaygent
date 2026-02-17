#!/usr/bin/env node
/**
 * Slack MCP server — send messages, read channels, check unread, react.
 * Token from ~/.relaygent/slack/token.json (user OAuth xoxp-).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { slack } from "./slack-client.mjs";

const server = new McpServer({ name: "slack", version: "1.0.0" });
const txt = (t) => ({ content: [{ type: "text", text: t }] });

server.tool("slack_send",
	"Send a Slack message to a channel or user. Pass a user ID (U...) or channel ID (C.../D...).",
	{ channel: z.string().describe("Channel ID, DM ID, or user ID (U... opens DM automatically)"),
	  text: z.string().describe("Message text (supports Slack markdown)") },
	async ({ channel, text: msg }) => {
		try {
			const res = await slack("chat.postMessage", { channel, text: msg });
			return txt(`Sent to ${res.channel} (ts: ${res.ts})`);
		} catch (e) { return txt(`Slack send error: ${e.message}`); }
	}
);

server.tool("slack_read",
	"Read recent messages from a Slack channel or DM.",
	{ channel: z.string().describe("Channel or DM ID"),
	  limit: z.number().default(20).describe("Number of messages (max 100)") },
	async ({ channel, limit }) => {
		try {
			const res = await slack("conversations.history", {
				channel, limit: Math.min(limit, 100),
			});
			if (!res.messages?.length) return txt("No messages.");
			const lines = res.messages.reverse().map(m => {
				const ts = new Date(parseFloat(m.ts) * 1000).toLocaleTimeString();
				const who = m.user || m.bot_id || "unknown";
				return `[${ts}] ${who}: ${m.text}`;
			});
			return txt(lines.join("\n"));
		} catch (e) { return txt(`Slack read error: ${e.message}`); }
	}
);

server.tool("slack_unread",
	"Check for unread Slack DMs and group DMs.",
	{},
	async () => {
		try {
			const res = await slack("conversations.list", {
				types: "im,mpim", exclude_archived: true, limit: 50,
			});
			const unread = (res.channels || []).filter(c =>
				(c.unread_count_display || 0) > 0
			);
			if (!unread.length) return txt("No unread Slack DMs.");
			const lines = [];
			for (const ch of unread) {
				const hist = await slack("conversations.history", {
					channel: ch.id, limit: ch.unread_count_display,
				});
				const msgs = (hist.messages || []).reverse();
				for (const m of msgs) {
					const ts = new Date(parseFloat(m.ts) * 1000).toLocaleTimeString();
					lines.push(`[${ch.id}] [${ts}] ${m.user || "bot"}: ${m.text}`);
				}
			}
			return txt(`${unread.length} channel(s) with unread:\n${lines.join("\n")}`);
		} catch (e) { return txt(`Slack unread error: ${e.message}`); }
	}
);

server.tool("slack_channels",
	"List Slack channels the user is a member of.",
	{ types: z.string().default("public_channel,private_channel,im,mpim")
		.describe("Channel types to list") },
	async ({ types }) => {
		try {
			const res = await slack("conversations.list", {
				types, exclude_archived: true, limit: 100,
			});
			const lines = (res.channels || []).map(c => {
				const name = c.name || c.user || c.id;
				const unread = c.unread_count_display ? ` (${c.unread_count_display} unread)` : "";
				return `${c.id}: ${name}${unread}`;
			});
			return txt(lines.join("\n") || "No channels found.");
		} catch (e) { return txt(`Slack channels error: ${e.message}`); }
	}
);

server.tool("slack_users",
	"List users in the Slack workspace.",
	{},
	async () => {
		try {
			const res = await slack("users.list", {});
			const users = (res.members || []).filter(u => !u.deleted && !u.is_bot);
			const lines = users.map(u =>
				`${u.id}: ${u.real_name || u.name} (@${u.name})`
			);
			return txt(lines.join("\n") || "No users found.");
		} catch (e) { return txt(`Slack users error: ${e.message}`); }
	}
);

server.tool("slack_react",
	"Add an emoji reaction to a message.",
	{ channel: z.string().describe("Channel ID"),
	  timestamp: z.string().describe("Message timestamp (ts)"),
	  emoji: z.string().describe("Emoji name without colons (e.g. thumbsup)") },
	async ({ channel, timestamp, emoji }) => {
		try {
			await slack("reactions.add", { channel, timestamp, name: emoji });
			return txt(`Reacted with :${emoji}:`);
		} catch (e) { return txt(`Slack react error: ${e.message}`); }
	}
);

server.tool("slack_search",
	"Search Slack messages.",
	{ query: z.string().describe("Search query"),
	  count: z.number().default(10).describe("Number of results") },
	async ({ query, count }) => {
		try {
			const res = await slack("search.messages", { query, count });
			const matches = res.messages?.matches || [];
			if (!matches.length) return txt("No results.");
			const lines = matches.map(m => {
				const ts = new Date(parseFloat(m.ts) * 1000).toLocaleString();
				return `[${ts}] ${m.username}: ${m.text}\n  Channel: ${m.channel?.name || m.channel?.id}`;
			});
			return txt(lines.join("\n\n"));
		} catch (e) { return txt(`Slack search error: ${e.message}`); }
	}
);

const transport = new StdioServerTransport();
await server.connect(transport);
