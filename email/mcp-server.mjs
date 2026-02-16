#!/usr/bin/env node
/**
 * Gmail MCP server — search, read, send, draft, modify, list labels.
 * OAuth credentials from ~/.relaygent/gmail/ (keys + tokens).
 * Extracted from unsupervised-claude/comms-gateway.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getGmailClient } from "./gmail-client.mjs";

const server = new McpServer({ name: "email", version: "1.0.0" });
const txt = (t) => ({ content: [{ type: "text", text: t }] });

server.tool("search_emails",
	"Search Gmail (e.g., 'from:someone subject:hello', 'is:unread', 'newer_than:1d').",
	{ query: z.string().describe("Gmail search query"),
	  limit: z.number().default(10).describe("Max results") },
	async ({ query, limit }) => {
		try {
			const gmail = getGmailClient();
			const res = await gmail.users.messages.list({ userId: "me", q: query, maxResults: limit });
			const msgs = res.data.messages || [];
			if (!msgs.length) return txt("No emails found.");
			const lines = [];
			for (const m of msgs) {
				const d = await gmail.users.messages.get({ userId: "me", id: m.id,
					format: "metadata", metadataHeaders: ["From", "To", "Subject", "Date"] });
				const h = d.data.payload?.headers || [];
				const get = (n) => h.find(x => x.name === n)?.value || "";
				lines.push(`[${get("Date")}] From: ${get("From")}\n  Subject: ${get("Subject")}\n  ${d.data.snippet || ""}\n  ID: ${m.id}`);
			}
			return txt(lines.join("\n\n"));
		} catch (e) { return txt(`Gmail search error: ${e.message}`); }
	}
);

server.tool("read_email", "Read a specific email by message ID.",
	{ message_id: z.string().describe("Gmail message ID") },
	async ({ message_id }) => {
		try {
			const gmail = getGmailClient();
			const res = await gmail.users.messages.get({ userId: "me", id: message_id, format: "full" });
			const headers = res.data.payload?.headers || [];
			const get = (n) => headers.find(h => h.name === n)?.value || "";
			let body = "";
			function extractText(part) {
				if (part.mimeType === "text/plain" && part.body?.data)
					body += Buffer.from(part.body.data, "base64url").toString("utf-8");
				if (part.parts) part.parts.forEach(extractText);
			}
			if (res.data.payload) extractText(res.data.payload);
			if (!body) body = res.data.snippet || "";
			const attachments = [];
			function findAttachments(part) {
				if (part.filename && part.body?.attachmentId)
					attachments.push(`${part.filename} (${part.mimeType}, ${part.body.size || 0}b)`);
				if (part.parts) part.parts.forEach(findAttachments);
			}
			if (res.data.payload) findAttachments(res.data.payload);
			let result = `From: ${get("From")}\nTo: ${get("To")}\nDate: ${get("Date")}\nSubject: ${get("Subject")}\nLabels: ${(res.data.labelIds || []).join(", ")}\n\n${body}`;
			if (attachments.length) result += `\n\nAttachments:\n${attachments.join("\n")}`;
			return txt(result);
		} catch (e) { return txt(`Gmail read error: ${e.message}`); }
	}
);

server.tool("send_email", "Send an email via Gmail.",
	{ to: z.string().describe("Recipient email"),
	  subject: z.string().describe("Subject"),
	  body: z.string().describe("Body (plain text)"),
	  cc: z.string().optional().describe("CC (comma-separated)"),
	  bcc: z.string().optional().describe("BCC (comma-separated)") },
	async ({ to, subject, body, cc, bcc }) => {
		try {
			const gmail = getGmailClient();
			const encSubj = /[^\x20-\x7E]/.test(subject)
				? `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=` : subject;
			let hdrs = `To: ${to}\nSubject: ${encSubj}\nContent-Type: text/plain; charset=utf-8\n`;
			if (cc) hdrs += `Cc: ${cc}\n`;
			if (bcc) hdrs += `Bcc: ${bcc}\n`;
			const raw = Buffer.from(`${hdrs}\n${body}`).toString("base64url");
			const res = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
			return txt(`Email sent to ${to} (ID: ${res.data.id})`);
		} catch (e) { return txt(`Gmail send error: ${e.message}`); }
	}
);

server.tool("draft_email", "Create a Gmail draft (not sent).",
	{ to: z.string().describe("Recipient"), subject: z.string().describe("Subject"),
	  body: z.string().describe("Body") },
	async ({ to, subject, body }) => {
		try {
			const gmail = getGmailClient();
			const encSubj = /[^\x20-\x7E]/.test(subject)
				? `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=` : subject;
			const raw = Buffer.from(`To: ${to}\nSubject: ${encSubj}\nContent-Type: text/plain; charset=utf-8\n\n${body}`).toString("base64url");
			const res = await gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw } } });
			return txt(`Draft created (ID: ${res.data.id})`);
		} catch (e) { return txt(`Gmail draft error: ${e.message}`); }
	}
);

server.tool("modify_email", "Modify email labels (archive, star, mark read, etc.).",
	{ message_id: z.string().describe("Gmail message ID"),
	  add_labels: z.array(z.string()).optional().describe("Labels to add"),
	  remove_labels: z.array(z.string()).optional().describe("Labels to remove") },
	async ({ message_id, add_labels, remove_labels }) => {
		try {
			const gmail = getGmailClient();
			await gmail.users.messages.modify({ userId: "me", id: message_id,
				requestBody: { addLabelIds: add_labels || [], removeLabelIds: remove_labels || [] } });
			const acts = [];
			if (add_labels?.length) acts.push(`added: ${add_labels.join(", ")}`);
			if (remove_labels?.length) acts.push(`removed: ${remove_labels.join(", ")}`);
			return txt(`Email ${message_id} modified (${acts.join("; ")})`);
		} catch (e) { return txt(`Gmail modify error: ${e.message}`); }
	}
);

server.tool("list_email_labels", "List available Gmail labels.", {}, async () => {
	try {
		const gmail = getGmailClient();
		const res = await gmail.users.labels.list({ userId: "me" });
		return txt((res.data.labels || []).map(l => `${l.name} (${l.id})`).sort().join("\n"));
	} catch (e) { return txt(`Gmail labels error: ${e.message}`); }
});

const transport = new StdioServerTransport();
await server.connect(transport);
