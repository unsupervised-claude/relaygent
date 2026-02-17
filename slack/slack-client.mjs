/**
 * Slack Web API client. Reads token from ~/.relaygent/slack/token.json.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

let _token = null;

export function getToken() {
	if (_token) return _token;
	const tokenPath = join(homedir(), ".relaygent", "slack", "token.json");
	const data = JSON.parse(readFileSync(tokenPath, "utf-8"));
	_token = data.access_token;
	return _token;
}

export async function slack(method, params = {}) {
	const token = getToken();
	const res = await fetch(`https://slack.com/api/${method}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json; charset=utf-8",
		},
		body: JSON.stringify(params),
	});
	const data = await res.json();
	if (!data.ok) throw new Error(`Slack ${method}: ${data.error}`);
	return data;
}
