import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ALG = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = join(__dirname, '..', '..', '..');
const KEY_FILE = join(process.env.RELAYGENT_DATA_DIR || join(REPO_DIR, 'data'), 'hub-chat', 'chat.key');
let keyBuf = null;

function getKey() {
	if (keyBuf) return keyBuf;
	try {
		keyBuf = Buffer.from(readFileSync(KEY_FILE, 'utf-8').trim(), 'hex');
	} catch {
		const hex = randomBytes(32).toString('hex');
		mkdirSync(join(KEY_FILE, '..'), { recursive: true });
		writeFileSync(KEY_FILE, hex, { mode: 0o600 });
		keyBuf = Buffer.from(hex, 'hex');
	}
	return keyBuf;
}

/** Encrypt plaintext → hex string (iv + tag + ciphertext) */
export function encrypt(plaintext) {
	const key = getKey();
	const iv = randomBytes(IV_LEN);
	const cipher = createCipheriv(ALG, key, iv);
	const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([iv, tag, enc]).toString('hex');
}

/** Decrypt hex string → plaintext. Returns null on failure. */
export function decrypt(hex) {
	try {
		const key = getKey();
		const buf = Buffer.from(hex, 'hex');
		if (buf.length < IV_LEN + TAG_LEN + 1) return null;
		const iv = buf.subarray(0, IV_LEN);
		const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
		const enc = buf.subarray(IV_LEN + TAG_LEN);
		const decipher = createDecipheriv(ALG, key, iv);
		decipher.setAuthTag(tag);
		return decipher.update(enc, undefined, 'utf8') + decipher.final('utf8');
	} catch {
		return null;
	}
}

/** Try to decrypt; if it fails, assume plaintext and return as-is */
export function decryptOrPassthrough(value) {
	if (!value) return value;
	if (/^[0-9a-f]{58,}$/i.test(value)) {
		const result = decrypt(value);
		if (result !== null) return result;
	}
	return value;
}
