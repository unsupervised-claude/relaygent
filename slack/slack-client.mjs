/**
 * Slack Web API client — user tokens (xoxp-).
 * Token from ~/.relaygent/slack/token.json: { "access_token": "xoxp-..." }
 * Rate-limit aware with automatic retry on 429.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const SLACK_DIR = join(homedir(), ".relaygent", "slack");
const TOKEN_PATH = join(SLACK_DIR, "token.json");
const BASE_URL = "https://slack.com/api";

let token = null;

export function getToken() {
	if (token) return token;
	if (!existsSync(TOKEN_PATH)) {
		throw new Error(
			`Slack token not found at ${TOKEN_PATH}. ` +
			`Create it with: { "access_token": "xoxp-..." }`
		);
	}
	const data = JSON.parse(readFileSync(TOKEN_PATH, "utf-8"));
	token = data.access_token;
	if (!token) throw new Error("No access_token in token.json");
	process.stderr.write("[slack] Token loaded\n");
	return token;
}

export async function slackApi(method, params = {}) {
	const t = getToken();
	const res = await fetch(`${BASE_URL}/${method}`, {
		method: "POST",
		headers: {
			"Authorization": `Bearer ${t}`,
			"Content-Type": "application/json; charset=utf-8",
		},
		body: JSON.stringify(params),
	});
	if (res.status === 429) {
		const retry = parseInt(res.headers.get("Retry-After") || "5", 10);
		process.stderr.write(`[slack] Rate limited, retrying in ${retry}s\n`);
		await new Promise(r => setTimeout(r, retry * 1000));
		return slackApi(method, params);
	}
	const data = await res.json();
	if (!data.ok) throw new Error(`Slack ${method}: ${data.error}`);
	return data;
}
