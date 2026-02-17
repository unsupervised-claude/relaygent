#!/usr/bin/env node
/**
 * Secrets MCP server — exposes get/set/list/delete to Claude.
 * Secrets stored as JSON with file-permission protection (chmod 600).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getSecret, setSecret, listSecrets, deleteSecret, createVault, vaultExists } from "./vault.mjs";

const server = new McpServer({ name: "secrets", version: "2.0.0" });
const txt = (t) => ({ content: [{ type: "text", text: t }] });

// Auto-create secrets file if it doesn't exist
if (!vaultExists()) createVault();

server.tool("secrets_get", "Get a secret by name.",
	{ name: z.string().describe("Secret name") },
	async ({ name }) => {
		try {
			const val = getSecret(name);
			return val !== null ? txt(val) : txt(`Secret "${name}" not found.`);
		} catch (e) { return txt(`Error: ${e.message}`); }
	}
);

server.tool("secrets_set", "Store a secret.",
	{ name: z.string().describe("Secret name"), value: z.string().describe("Secret value") },
	async ({ name, value }) => {
		try {
			setSecret(name, value);
			return txt(`Secret "${name}" stored.`);
		} catch (e) { return txt(`Error: ${e.message}`); }
	}
);

server.tool("secrets_list", "List all secret names.", {},
	async () => {
		try {
			const keys = listSecrets();
			return keys.length ? txt(keys.join("\n")) : txt("(empty)");
		} catch (e) { return txt(`Error: ${e.message}`); }
	}
);

server.tool("secrets_delete", "Delete a secret.",
	{ name: z.string().describe("Secret name to delete") },
	async ({ name }) => {
		try {
			deleteSecret(name);
			return txt(`Secret "${name}" deleted.`);
		} catch (e) { return txt(`Error: ${e.message}`); }
	}
);

const transport = new StdioServerTransport();
await server.connect(transport);
