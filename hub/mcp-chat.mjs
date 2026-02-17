#!/usr/bin/env node
/**
 * Hub Chat MCP Server — lets Claude interact with the hub chat.
 * Talks to the hub's HTTP API on the configured port.
 */
import { writeFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const NOTIF_CACHE = "/tmp/relaygent-notifications-cache.json";

const HUB_PORT = process.env.HUB_PORT || "8080";
const API = `http://127.0.0.1:${HUB_PORT}/api/chat`;

async function api(path, method = "GET", body = null) {
	const opts = { method, headers: { "Content-Type": "application/json" } };
	if (body) opts.body = JSON.stringify(body);
	const res = await fetch(`${API}${path}`, opts);
	if (!res.ok) throw new Error(`Hub API ${method} ${path}: ${res.status} ${res.statusText}`);
	return res.json();
}

function text(msg) {
	return { content: [{ type: "text", text: typeof msg === "string" ? msg : JSON.stringify(msg, null, 2) }] };
}

const tools = [
	{
		name: "read_messages",
		description: "Read chat messages. Use mode='unread' to get only unread human messages, or omit for recent history.",
		inputSchema: {
			type: "object",
			properties: {
				mode: { type: "string", enum: ["unread", "history"], description: "unread = new human messages, history = recent messages (default: unread)" },
				limit: { type: "number", description: "Number of messages for history mode (default: 20)" },
			},
		},
	},
	{
		name: "send_message",
		description: "Send a message in the hub chat (as the assistant).",
		inputSchema: {
			type: "object",
			properties: {
				content: { type: "string", description: "Message text to send" },
			},
			required: ["content"],
		},
	},
	{
		name: "mark_read",
		description: "Mark specific chat messages as read by their IDs.",
		inputSchema: {
			type: "object",
			properties: {
				ids: { type: "array", items: { type: "number" }, description: "Message IDs to mark as read" },
			},
			required: ["ids"],
		},
	},
];

const server = new Server(
	{ name: "hub-chat", version: "1.0.0" },
	{ capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const { name, arguments: args } = request.params;
	try {
		switch (name) {
			case "read_messages": {
				const mode = args?.mode || "unread";
				if (mode === "unread") {
					const data = await api("?mode=unread");
					if (!data.count) return text("No unread messages.");
					const lines = data.messages.map(m => m.content);
					await api("", "PATCH", { ids: data.messages.map(m => m.id) });
					try { writeFileSync(NOTIF_CACHE, "[]"); } catch {}
					return text(`${data.count} unread message(s):\n${lines.join("\n")}`);
				}
				const limit = args?.limit || 20;
				const data = await api(`?limit=${limit}`);
				const msgs = (data.messages || []).reverse();
				if (!msgs.length) return text("No messages yet.");
				const lines = msgs.map(m => `[${m.id}] ${m.role}: ${m.content}`);
				return text(lines.join("\n"));
			}
			case "send_message": {
				const msg = await api("", "POST", { content: args.content, role: "assistant" });
				return text(`Sent (id: ${msg.id}): ${msg.content}`);
			}
			case "mark_read": {
				await api("", "PATCH", { ids: args.ids });
				try { writeFileSync(NOTIF_CACHE, "[]"); } catch {}
				return text(`Marked ${args.ids.length} message(s) as read.`);
			}
			default:
				return text(`Unknown tool: ${name}`);
		}
	} catch (error) {
		return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
	}
});

const transport = new StdioServerTransport();
await server.connect(transport);
