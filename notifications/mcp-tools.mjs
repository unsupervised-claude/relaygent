/**
 * Relaygent Notifications MCP — tool definitions.
 */

export const tools = [
  {
    name: "set_reminder",
    description: "Set a self-reminder to wake at a specific time. Use ISO format for time (e.g., 2026-01-30T16:30:00). For recurring reminders, add a cron expression.",
    inputSchema: {
      type: "object",
      properties: {
        trigger_time: {
          type: "string",
          description: "When to trigger (ISO format, e.g., 2026-01-30T16:30:00)",
        },
        message: {
          type: "string",
          description: "What to remind about",
        },
        recurrence: {
          type: "string",
          description: "Optional cron expression for recurring reminders (e.g., '0 9 * * *' for daily at 9am)",
        },
      },
      required: ["trigger_time", "message"],
    },
  },
  {
    name: "list_reminders",
    description: "List all pending (unfired) reminders",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "cancel_reminder",
    description: "Cancel a reminder by ID",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Reminder ID to cancel" },
      },
      required: ["id"],
    },
  },
  {
    name: "get_pending_triggers",
    description: "Get reminders that are due now (for harness polling)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "sleep",
    description: "Go to sleep until a notification arrives (reminder, chat message, or other configured sources). Returns immediately — the relay harness handles the actual wait with zero token cost. You will be woken via session resume when a notification arrives. After calling this, finish your turn to enter sleep.",
    inputSchema: {
      type: "object",
      properties: {
        max_minutes: {
          type: "number",
          description: "Optional max sleep duration in minutes. Sets a wake reminder so the harness wakes you after this time even if no notification arrives. Omit to sleep indefinitely.",
        },
      },
    },
  },
];
