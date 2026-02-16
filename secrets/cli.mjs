#!/usr/bin/env node
/**
 * Secrets vault CLI — get/set/list/delete encrypted secrets.
 * Usage: node cli.mjs <get|set|list|delete> [name] [value]
 * Master password read from RELAYGENT_MASTER_PASSWORD env var or prompted.
 */
import { createInterface } from "readline";
import { getSecret, setSecret, listSecrets, deleteSecret, vaultExists, createVault } from "./vault.mjs";

const [,, cmd, name, ...rest] = process.argv;
const value = rest.join(" ");

function promptPassword() {
	return new Promise(resolve => {
		const rl = createInterface({ input: process.stdin, output: process.stderr });
		process.stderr.write("Master password: ");
		rl.question("", answer => { rl.close(); resolve(answer.trim()); });
	});
}

async function main() {
	const password = process.env.RELAYGENT_MASTER_PASSWORD || await promptPassword();
	if (!password) { console.error("No password provided."); process.exit(1); }

	if (!vaultExists() && cmd !== "init") {
		console.error("No vault found. Run setup or: node cli.mjs init"); process.exit(1);
	}

	switch (cmd) {
		case "init":
			if (vaultExists()) { console.error("Vault already exists."); process.exit(1); }
			createVault(password);
			console.log("Vault created.");
			break;
		case "get":
			if (!name) { console.error("Usage: secrets get <name>"); process.exit(1); }
			const val = getSecret(password, name);
			if (val === null) { console.error(`Secret "${name}" not found.`); process.exit(1); }
			process.stdout.write(val);
			break;
		case "set":
			if (!name || !value) { console.error("Usage: secrets set <name> <value>"); process.exit(1); }
			setSecret(password, name, value);
			console.error(`Secret "${name}" stored.`);
			break;
		case "list":
			const keys = listSecrets(password);
			if (keys.length) console.log(keys.join("\n"));
			else console.log("(empty)");
			break;
		case "delete":
			if (!name) { console.error("Usage: secrets delete <name>"); process.exit(1); }
			deleteSecret(password, name);
			console.error(`Secret "${name}" deleted.`);
			break;
		default:
			console.log("Usage: secrets <get|set|list|delete|init> [name] [value]");
	}
}

main().catch(e => { console.error(e.message); process.exit(1); });
