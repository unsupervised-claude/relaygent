#!/usr/bin/env node
/**
 * Relaygent Notifications MCP Server — thin entry point.
 *
 * Provides tools for the relay agent to set self-reminders and sleep.
 * Talks to the notifications Flask API.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { tools } from "./mcp-tools.mjs";

const API_PORT = process.env.RELAYGENT_NOTIFICATIONS_PORT || "8083";
const API_URL = `http://127.0.0.1:${API_PORT}`;

async function apiCall(path, method = "GET", body = null) {
  const options = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) options.body = JSON.stringify(body);
  const response = await fetch(`${API_URL}${path}`, options);
  return response.json();
}

function text(msg) {
  return { content: [{ type: "text", text: msg }] };
}

const server = new Server(
  { name: "relaygent-notifications", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "set_reminder": {
        const body = { trigger_time: args.trigger_time, message: args.message };
        if (args.recurrence) body.recurrence = args.recurrence;
        const result = await apiCall("/reminder", "POST", body);
        const recur = args.recurrence ? ` (recurring: ${args.recurrence})` : "";
        return text(`Reminder set (ID: ${result.id}). Will trigger at ${args.trigger_time}${recur}: "${args.message}"`);
      }
      case "list_reminders": {
        const reminders = await apiCall("/upcoming");
        if (reminders.length === 0) return text("No pending reminders.");
        const list = reminders.map(r => {
          const recur = r.recurrence ? ` [${r.recurrence}]` : "";
          return `- [${r.id}] ${r.trigger_time}${recur}: ${r.message}`;
        }).join("\n");
        return text(`Pending reminders:\n${list}`);
      }
      case "cancel_reminder":
        await apiCall(`/reminder/${args.id}`, "DELETE");
        return text(`Reminder ${args.id} cancelled.`);
      case "get_pending_triggers": {
        const pending = await apiCall("/pending");
        if (pending.length === 0) return text("No triggers due.");
        const list = pending.map(r => `- [${r.id}] ${r.message}`).join("\n");
        return text(`Due now:\n${list}`);
      }
      case "sleep": {
        let timeMsg = "indefinitely (until a notification arrives)";
        if (args.max_minutes) {
          const wakeTime = new Date(Date.now() + args.max_minutes * 60000);
          const pad = (n) => String(n).padStart(2, "0");
          const isoTime = `${wakeTime.getFullYear()}-${pad(wakeTime.getMonth() + 1)}-${pad(wakeTime.getDate())}T${pad(wakeTime.getHours())}:${pad(wakeTime.getMinutes())}:${pad(wakeTime.getSeconds())}`;
          try {
            await apiCall("/reminder", "POST", {
              trigger_time: isoTime,
              message: `Sleep timeout (${args.max_minutes} min)`,
            });
            timeMsg = `for up to ${args.max_minutes} minutes (wake reminder set for ${isoTime})`;
          } catch (e) {
            timeMsg = `for up to ${args.max_minutes} minutes (warning: failed to set wake reminder)`;
          }
        }
        return text(
          `Sleep activated ${timeMsg}. The relay harness handles the wait ` +
          "with zero token cost. You'll be woken via resume when a notification " +
          "arrives (chat message, reminder, etc). Finish your turn now to enter sleep."
        );
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
