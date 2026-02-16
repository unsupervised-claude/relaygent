import { json } from '@sveltejs/kit';
import fs from 'fs';

const SCREENSHOT_PATH = '/tmp/claude-screenshot.png';
const HS_PORT = process.env.HAMMERSPOON_PORT || '8097';
const HAMMERSPOON_URL = `http://127.0.0.1:${HS_PORT}/screenshot`;

export async function GET() {
	try {
		await fetch(HAMMERSPOON_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ path: SCREENSHOT_PATH })
		});
		const data = fs.readFileSync(SCREENSHOT_PATH);
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
