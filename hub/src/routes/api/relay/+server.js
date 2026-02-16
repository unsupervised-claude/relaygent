import { json } from '@sveltejs/kit';
import fs from 'fs';
import path from 'path';
import { parseSession, findLatestSession } from '$lib/relayActivity.js';

// Session IDs are UUIDs — reject anything else to prevent path traversal
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function findSessionById(sessionId) {
	if (!SESSION_ID_RE.test(sessionId)) return null;
	const claudeProjects = path.join(process.env.HOME, '.claude', 'projects');
	try {
		for (const dir of fs.readdirSync(claudeProjects)) {
			const fullPath = path.join(claudeProjects, dir);
			try { if (!fs.statSync(fullPath).isDirectory()) continue; } catch { continue; }
			const filePath = path.join(fullPath, `${sessionId}.jsonl`);
			if (fs.existsSync(filePath)) return filePath;
		}
	} catch { /* ignore */ }
	return null;
}

export function GET({ url }) {
	const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
	const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 200));
	const sessionId = url.searchParams.get('session');

	const sessionFile = sessionId ? findSessionById(sessionId) : findLatestSession();
	if (!sessionFile) return json({ activities: [], hasMore: false });

	const activity = parseSession(sessionFile, 500);
	const reversed = activity.reverse();
	const paginated = reversed.slice(offset, offset + limit);

	return json({ activities: paginated, hasMore: offset + limit < reversed.length, total: reversed.length });
}
