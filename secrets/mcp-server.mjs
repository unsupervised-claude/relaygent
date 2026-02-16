#!/usr/bin/env node
/**
 * Secrets MCP server — exposes vault get/set/list/delete to Claude.
 * Master password via RELAYGENT_MASTER_PASSWORD env var.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getSecret, setSecret, listSecrets, deleteSecret, vaultExists } from "./vault.mjs";

const password = process.env.RELAYGENT_MASTER_PASSWORD;
if (!password) {
	process.stderr.write("[secrets] ERROR: RELAYGENT_MASTER_PASSWORD not set\n");
	process.exit(1);
}

const server = new McpServer({ name: "secrets", version: "1.0.0" });
const txt = (t) => ({ content: [{ type: "text", text: t }] });

server.tool("secrets_get", "Get a secret by name. Output goes to stdout only (safe for passwords).",
	{ name: z.string().describe("Secret name") },
	async ({ name }) => {
		if (!vaultExists()) return txt("Error: vault not found. Run setup first.");
		try {
			const val = getSecret(password, name);
			return val !== null ? txt(val) : txt(`Secret "${name}" not found.`);
		} catch (e) { return txt(`Error: ${e.message}`); }
	}
);

server.tool("secrets_set", "Store a secret in the encrypted vault.",
	{ name: z.string().describe("Secret name"), value: z.string().describe("Secret value") },
	async ({ name, value }) => {
		if (!vaultExists()) return txt("Error: vault not found. Run setup first.");
		try {
			setSecret(password, name, value);
			return txt(`Secret "${name}" stored.`);
		} catch (e) { return txt(`Error: ${e.message}`); }
	}
);

server.tool("secrets_list", "List all secret names in the vault.", {},
	async () => {
		if (!vaultExists()) return txt("Error: vault not found. Run setup first.");
		try {
			const keys = listSecrets(password);
			return keys.length ? txt(keys.join("\n")) : txt("(empty)");
		} catch (e) { return txt(`Error: ${e.message}`); }
	}
);

server.tool("secrets_delete", "Delete a secret from the vault.",
	{ name: z.string().describe("Secret name to delete") },
	async ({ name }) => {
		if (!vaultExists()) return txt("Error: vault not found. Run setup first.");
		try {
			deleteSecret(password, name);
			return txt(`Secret "${name}" deleted.`);
		} catch (e) { return txt(`Error: ${e.message}`); }
	}
);

const transport = new StdioServerTransport();
await server.connect(transport);
