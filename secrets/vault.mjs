/**
 * Secrets store with AES-256-GCM encryption.
 * Master key is auto-generated on first use and stored at ~/.relaygent/master.key (chmod 600).
 * No manual password required — key lives locally alongside the secrets file.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { readFileSync, writeFileSync, existsSync, renameSync, chmodSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

const DIR = join(homedir(), ".relaygent");
const SECRETS_PATH = join(DIR, "secrets.json");
const KEY_PATH = join(DIR, "master.key");
const ALG = "aes-256-gcm";

function getMasterKey() {
	if (existsSync(KEY_PATH)) {
		return Buffer.from(readFileSync(KEY_PATH, "utf-8").trim(), "hex");
	}
	mkdirSync(DIR, { recursive: true });
	const key = randomBytes(32).toString("hex");
	writeFileSync(KEY_PATH, key, { mode: 0o600 });
	chmodSync(KEY_PATH, 0o600);
	return Buffer.from(key, "hex");
}

function encryptValue(plaintext) {
	const key = getMasterKey();
	const iv = randomBytes(12);
	const cipher = createCipheriv(ALG, key, iv);
	const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([iv, tag, enc]).toString("hex");
}

function decryptValue(hex) {
	try {
		const key = getMasterKey();
		const buf = Buffer.from(hex, "hex");
		if (buf.length < 29) return hex; // too short — treat as plaintext
		const iv = buf.subarray(0, 12);
		const tag = buf.subarray(12, 28);
		const enc = buf.subarray(28);
		const decipher = createDecipheriv(ALG, key, iv);
		decipher.setAuthTag(tag);
		return decipher.update(enc, undefined, "utf8") + decipher.final("utf8");
	} catch {
		return hex; // fallback: return as-is if decryption fails
	}
}

function isEncrypted(val) {
	return typeof val === "string" && /^[0-9a-f]{58,}$/i.test(val);
}

function load() {
	if (!existsSync(SECRETS_PATH)) return {};
	try {
		const raw = JSON.parse(readFileSync(SECRETS_PATH, "utf-8"));
		// Decrypt all values on read
		return Object.fromEntries(
			Object.entries(raw).map(([k, v]) => [k, isEncrypted(v) ? decryptValue(v) : v])
		);
	} catch {
		return {};
	}
}

function save(secrets) {
	mkdirSync(DIR, { recursive: true });
	// Encrypt all values on write
	const encrypted = Object.fromEntries(
		Object.entries(secrets).map(([k, v]) => [k, encryptValue(String(v))])
	);
	const tmp = SECRETS_PATH + ".tmp";
	writeFileSync(tmp, JSON.stringify(encrypted, null, 2), { mode: 0o600 });
	renameSync(tmp, SECRETS_PATH);
	chmodSync(SECRETS_PATH, 0o600);
}

export function vaultExists() { return existsSync(SECRETS_PATH); }
export function createVault() { if (!existsSync(SECRETS_PATH)) { getMasterKey(); save({}); } }
export function getSecret(name) { return load()[name] ?? null; }
export function setSecret(name, value) { const s = load(); s[name] = value; save(s); }
export function listSecrets() { return Object.keys(load()); }
export function deleteSecret(name) { const s = load(); delete s[name]; save(s); }
