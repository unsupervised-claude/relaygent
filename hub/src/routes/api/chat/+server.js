import { json } from '@sveltejs/kit';
import { getMessages, sendHumanMessage, sendAssistantMessage, getUnreadHumanMessages, markAsRead } from '$lib/chat.js';
import fs from 'fs';

const TRIGGER_FILE = '/tmp/hub-chat-new.json';

/** GET /api/chat — message history or unread check */
export function GET({ url }) {
	const mode = url.searchParams.get('mode');
	if (mode === 'unread') {
		const msgs = getUnreadHumanMessages();
		return json({ count: msgs.length, messages: msgs });
	}
	const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200));
	const rawBefore = url.searchParams.get('before');
	const before = rawBefore ? Math.max(1, parseInt(rawBefore, 10) || 0) : null;
	const messages = getMessages(limit, before);
	return json({ messages });
}

const MAX_CONTENT_LENGTH = 10000;

/** POST /api/chat — send a message */
export async function POST({ request }) {
	const { content, role } = await request.json();
	if (!content?.trim()) {
		return json({ error: 'Content is required' }, { status: 400 });
	}
	const trimmed = content.trim();
	if (trimmed.length > MAX_CONTENT_LENGTH) {
		return json({ error: `Content exceeds ${MAX_CONTENT_LENGTH} characters` }, { status: 400 });
	}
	const msg = role === 'assistant'
		? sendAssistantMessage(trimmed)
		: sendHumanMessage(trimmed);
	try { fs.writeFileSync(TRIGGER_FILE, JSON.stringify(msg)); } catch {}
	return json(msg, { status: 201 });
}

const MAX_MARK_READ = 100;

/** PATCH /api/chat — mark messages as read */
export async function PATCH({ request }) {
	const { ids } = await request.json();
	if (!Array.isArray(ids) || !ids.length) {
		return json({ error: 'ids must be a non-empty array' }, { status: 400 });
	}
	const validIds = ids.slice(0, MAX_MARK_READ).filter(id => Number.isInteger(id) && id > 0);
	if (validIds.length) markAsRead(validIds);
	return json({ ok: true });
}
