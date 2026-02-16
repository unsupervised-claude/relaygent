/**
 * Encrypted secrets vault — AES-256-GCM with PBKDF2 key derivation.
 * Stores secrets in ~/.relaygent/secrets.enc as encrypted JSON.
 */
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const VAULT_PATH = join(homedir(), ".relaygent", "secrets.enc");
const ALGORITHM = "aes-256-gcm";
const ITERATIONS = 100000;
const KEY_LEN = 32;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;

function deriveKey(password, salt) {
	return pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, "sha256");
}

function encrypt(plaintext, password) {
	const salt = randomBytes(SALT_LEN);
	const iv = randomBytes(IV_LEN);
	const key = deriveKey(password, salt);
	const cipher = createCipheriv(ALGORITHM, key, iv);
	const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	// Format: salt (16) + iv (12) + tag (16) + ciphertext
	return Buffer.concat([salt, iv, tag, encrypted]);
}

function decrypt(data, password) {
	const salt = data.subarray(0, SALT_LEN);
	const iv = data.subarray(SALT_LEN, SALT_LEN + IV_LEN);
	const tag = data.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
	const ciphertext = data.subarray(SALT_LEN + IV_LEN + TAG_LEN);
	const key = deriveKey(password, salt);
	const decipher = createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
}

export function vaultExists() {
	return existsSync(VAULT_PATH);
}

export function createVault(masterPassword) {
	const secrets = {};
	const data = encrypt(JSON.stringify(secrets), masterPassword);
	writeFileSync(VAULT_PATH, data);
}

export function loadVault(masterPassword) {
	if (!existsSync(VAULT_PATH)) throw new Error("Vault not found. Run setup first.");
	const data = readFileSync(VAULT_PATH);
	try {
		return JSON.parse(decrypt(data, masterPassword));
	} catch {
		throw new Error("Wrong master password or corrupted vault.");
	}
}

function saveVault(secrets, masterPassword) {
	const data = encrypt(JSON.stringify(secrets), masterPassword);
	writeFileSync(VAULT_PATH, data);
}

export function getSecret(masterPassword, name) {
	const secrets = loadVault(masterPassword);
	return secrets[name] ?? null;
}

export function setSecret(masterPassword, name, value) {
	const secrets = loadVault(masterPassword);
	secrets[name] = value;
	saveVault(secrets, masterPassword);
}

export function listSecrets(masterPassword) {
	const secrets = loadVault(masterPassword);
	return Object.keys(secrets);
}

export function deleteSecret(masterPassword, name) {
	const secrets = loadVault(masterPassword);
	delete secrets[name];
	saveVault(secrets, masterPassword);
}
