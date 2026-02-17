/**
 * Simple secrets store — JSON file with chmod 600 protection.
 * Follows the same pattern as gh, aws, gcloud, docker credentials.
 * No encryption, no master password — relies on OS file permissions.
 */
import { readFileSync, writeFileSync, existsSync, renameSync, chmodSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

const SECRETS_PATH = join(homedir(), ".relaygent", "secrets.json");

function ensureDir() {
	mkdirSync(dirname(SECRETS_PATH), { recursive: true });
}

function load() {
	if (!existsSync(SECRETS_PATH)) return {};
	try {
		return JSON.parse(readFileSync(SECRETS_PATH, "utf-8"));
	} catch {
		return {};
	}
}

function save(secrets) {
	ensureDir();
	const tmp = SECRETS_PATH + ".tmp";
	writeFileSync(tmp, JSON.stringify(secrets, null, 2), { mode: 0o600 });
	renameSync(tmp, SECRETS_PATH);
	chmodSync(SECRETS_PATH, 0o600);
}

export function vaultExists() {
	return existsSync(SECRETS_PATH);
}

export function createVault() {
	if (!existsSync(SECRETS_PATH)) save({});
}

export function getSecret(name) {
	return load()[name] ?? null;
}

export function setSecret(name, value) {
	const secrets = load();
	secrets[name] = value;
	save(secrets);
}

export function listSecrets() {
	return Object.keys(load());
}

export function deleteSecret(name) {
	const secrets = load();
	delete secrets[name];
	save(secrets);
}
