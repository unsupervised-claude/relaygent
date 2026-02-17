import { json } from '@sveltejs/kit';
import { execSync } from 'child_process';
import fs from 'fs';

const SCREENSHOT_PATH = '/tmp/claude-screenshot.png';
const SCALED_PATH = '/tmp/claude-screenshot-scaled.png';
const HS_PORT = process.env.HAMMERSPOON_PORT || '8097';
const HAMMERSPOON_URL = `http://127.0.0.1:${HS_PORT}/screenshot`;
const MAX_WIDTH = 1280; // Claude Code image size limit safety margin
const MAX_BYTES = 5 * 1024 * 1024; // 5MB — well under 20MB base64 limit

export async function GET() {
	try {
		await fetch(HAMMERSPOON_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ path: SCREENSHOT_PATH })
		});
		let imgPath = SCREENSHOT_PATH;
		const stat = fs.statSync(SCREENSHOT_PATH);
		if (stat.size > MAX_BYTES) {
			execSync(`sips -Z ${MAX_WIDTH} --out "${SCALED_PATH}" "${SCREENSHOT_PATH}"`, { timeout: 5000 });
			imgPath = SCALED_PATH;
		}
		const data = fs.readFileSync(imgPath);
		return new Response(data, {
			headers: {
				'Content-Type': 'image/png',
				'Cache-Control': 'no-cache, no-store',
			}
		});
	} catch {
		return json({ error: 'screenshot failed' }, { status: 502 });
	}
}
