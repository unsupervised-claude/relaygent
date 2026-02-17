#!/usr/bin/env node
/**
 * Secrets CLI — get/set/list/delete secrets.
 * Usage: node cli.mjs <get|set|list|delete> [name] [value]
 */
import { getSecret, setSecret, listSecrets, deleteSecret, createVault, vaultExists } from "./vault.mjs";

const [,, cmd, name, ...rest] = process.argv;
const value = rest.join(" ");

if (!vaultExists() && cmd !== "init") {
	console.error("No secrets file found. Run setup or: node cli.mjs init");
	process.exit(1);
}

switch (cmd) {
	case "init":
		if (vaultExists()) { console.error("Secrets file already exists."); process.exit(1); }
		createVault();
		console.log("Secrets file created.");
		break;
	case "get":
		if (!name) { console.error("Usage: secrets get <name>"); process.exit(1); }
		const val = getSecret(name);
		if (val === null) { console.error(`Secret "${name}" not found.`); process.exit(1); }
		process.stdout.write(val);
		break;
	case "set":
		if (!name || !value) { console.error("Usage: secrets set <name> <value>"); process.exit(1); }
		setSecret(name, value);
		console.error(`Secret "${name}" stored.`);
		break;
	case "list": {
		const keys = listSecrets();
		if (keys.length) console.log(keys.join("\n"));
		else console.log("(empty)");
		break;
	}
	case "delete":
		if (!name) { console.error("Usage: secrets delete <name>"); process.exit(1); }
		deleteSecret(name);
		console.error(`Secret "${name}" deleted.`);
		break;
	default:
		console.log("Usage: secrets <get|set|list|delete|init> [name] [value]");
}
