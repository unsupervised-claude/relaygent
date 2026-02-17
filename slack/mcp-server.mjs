#!/usr/bin/env node
/**
 * Slack MCP server — channels, messages, reactions, users.
 * Uses user tokens (xoxp-) so agent acts as a real user.
 * Token from ~/.relaygent/slack/token.json.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { slackApi } from "./slack-client.mjs";

const server = new McpServer({ name: "slack", version: "1.0.0" });
const txt = (t) => ({ content: [{ type: "text", text: t }] });

server.tool("channels",
	"List Slack channels the user has joined.",
	{ limit: z.number().default(100).describe("Max channels to return"),
	  types: z.string().default("public_channel,private_channel")
		.describe("Channel types (public_channel,private_channel,mpim,im)") },
	async ({ limit, types }) => {
		try {
			const data = await slackApi("conversations.list", {
				limit, types, exclude_archived: true,
			});
			const lines = (data.channels || []).map(c =>
				`#${c.name} (${c.id}) — ${c.num_members || 0} members` +
				(c.topic?.value ? ` — ${c.topic.value}` : "")
			);
			if (!lines.length) return txt("No channels found.");
			return txt(lines.join("\n"));
		} catch (e) { return txt(`Slack channels error: ${e.message}`); }
	}
);

server.tool("read_messages",
	"Read recent messages from a Slack channel.",
	{ channel: z.string().describe("Channel ID (e.g. C0123456789)"),
	  limit: z.number().default(20).describe("Number of messages") },
	async ({ channel, limit }) => {
		try {
			const data = await slackApi("conversations.history", {
				channel, limit,
			});
			const msgs = data.messages || [];
			if (!msgs.length) return txt("No messages in this channel.");
			const lines = msgs.reverse().map(m => {
				const ts = new Date(parseFloat(m.ts) * 1000)
					.toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
				const user = m.user || m.bot_id || "unknown";
				return `[${ts}] <${user}> ${m.text || ""}`;
			});
			return txt(lines.join("\n"));
		} catch (e) { return txt(`Slack read error: ${e.message}`); }
	}
);

server.tool("send_message",
	"Send a message to a Slack channel.",
	{ channel: z.string().describe("Channel ID"),
	  text: z.string().describe("Message text (supports Slack markdown)"),
	  thread_ts: z.string().optional()
		.describe("Thread timestamp to reply in a thread") },
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

server.tool("users",
	"List users in the Slack workspace.",
	{ limit: z.number().default(100).describe("Max users to return") },
	async ({ limit }) => {
		try {
			const data = await slackApi("users.list", { limit });
			const users = (data.members || [])
				.filter(u => !u.deleted && !u.is_bot && u.id !== "USLACKBOT");
			const lines = users.map(u =>
				`${u.real_name || u.name} (@${u.name}, ${u.id})` +
				(u.profile?.status_text ? ` — ${u.profile.status_text}` : "")
			);
			if (!lines.length) return txt("No users found.");
			return txt(lines.join("\n"));
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
			const lines = [
				`Name: #${c.name}`, `ID: ${c.id}`,
				`Topic: ${c.topic?.value || "(none)"}`,
				`Purpose: ${c.purpose?.value || "(none)"}`,
				`Members: ${c.num_members || 0}`,
				`Created: ${new Date(c.created * 1000).toISOString()}`,
				`Archived: ${c.is_archived}`,
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
			const data = await slackApi("search.messages", {
				query, count, sort: "timestamp", sort_dir: "desc",
			});
			const matches = data.messages?.matches || [];
			if (!matches.length) return txt("No messages found.");
			const lines = matches.map(m => {
				const ch = m.channel?.name || m.channel?.id || "?";
				return `[#${ch}] <${m.username || m.user}> ${m.text}`;
			});
			return txt(lines.join("\n\n"));
		} catch (e) { return txt(`Slack search error: ${e.message}`); }
	}
);

server.tool("unread",
	"Check channels with unread messages.",
	{},
	async () => {
		try {
			const data = await slackApi("conversations.list", {
				limit: 200, types: "public_channel,private_channel,mpim,im",
				exclude_archived: true,
			});
			const unread = (data.channels || [])
				.filter(c => c.unread_count > 0 || c.unread_count_display > 0);
			if (!unread.length) return txt("No unread messages.");
			const lines = unread.map(c =>
				`#${c.name || c.id}: ${c.unread_count_display || c.unread_count} unread`
			);
			return txt(lines.join("\n"));
		} catch (e) { return txt(`Slack unread error: ${e.message}`); }
	}
);

const transport = new StdioServerTransport();
await server.connect(transport);
