/**
 * Gmail OAuth2 client — auto-refreshing tokens.
 * Credentials at ~/.relaygent/gmail/ (gcp-oauth.keys.json + credentials.json).
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { google } from "googleapis";

const GMAIL_DIR = join(homedir(), ".relaygent", "gmail");
const KEYS_PATH = join(GMAIL_DIR, "gcp-oauth.keys.json");
const TOKEN_PATH = join(GMAIL_DIR, "credentials.json");

let client = null;

export function getGmailClient() {
	if (client) return client;
	if (!existsSync(KEYS_PATH)) {
		throw new Error(`Gmail OAuth keys not found at ${KEYS_PATH}. Run setup or see README.`);
	}
	if (!existsSync(TOKEN_PATH)) {
		throw new Error(`Gmail tokens not found at ${TOKEN_PATH}. Complete OAuth flow first.`);
	}
	const keys = JSON.parse(readFileSync(KEYS_PATH, "utf-8"));
	const tokens = JSON.parse(readFileSync(TOKEN_PATH, "utf-8"));
	const { client_id, client_secret, redirect_uris } = keys.installed || keys.web;
	const oauth2 = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
	oauth2.setCredentials(tokens);
	// Auto-persist refreshed tokens
	oauth2.on("tokens", (newTokens) => {
		const current = JSON.parse(readFileSync(TOKEN_PATH, "utf-8"));
		writeFileSync(TOKEN_PATH, JSON.stringify({ ...current, ...newTokens }, null, 2));
		process.stderr.write("[email] OAuth tokens refreshed\n");
	});
	client = google.gmail({ version: "v1", auth: oauth2 });
	process.stderr.write("[email] Gmail client initialized\n");
	return client;
}

/**
 * Run OAuth2 flow to get initial tokens. Opens URL for user/agent to visit.
 * Returns the authorization URL — agent completes via browser (computer-use).
 */
export function getAuthUrl() {
	if (!existsSync(KEYS_PATH)) {
		throw new Error(`Gmail OAuth keys not found at ${KEYS_PATH}`);
	}
	const keys = JSON.parse(readFileSync(KEYS_PATH, "utf-8"));
	const { client_id, client_secret, redirect_uris } = keys.installed || keys.web;
	const oauth2 = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
	return oauth2.generateAuthUrl({
		access_type: "offline", prompt: "consent",
		scope: ["https://www.googleapis.com/auth/gmail.modify"],
	});
}

/** Exchange authorization code for tokens and save them. */
export async function exchangeCode(code) {
	const keys = JSON.parse(readFileSync(KEYS_PATH, "utf-8"));
	const { client_id, client_secret, redirect_uris } = keys.installed || keys.web;
	const oauth2 = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
	const { tokens } = await oauth2.getToken(code);
	writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
	process.stderr.write("[email] OAuth tokens saved\n");
	client = null; // Reset so next getGmailClient() picks up new tokens
}
