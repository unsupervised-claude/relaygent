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
	const limit = parseInt(url.searchParams.get('limit') || '50', 10);
	const before = url.searchParams.get('before');
	const messages = getMessages(limit, before ? parseInt(before, 10) : null);
	return json({ messages });
}

/** POST /api/chat — send a message */
export async function POST({ request }) {
	const { content, role } = await request.json();
	if (!content?.trim()) {
		return json({ error: 'Content is required' }, { status: 400 });
	}
	const msg = role === 'assistant'
		? sendAssistantMessage(content.trim())
		: sendHumanMessage(content.trim());
	try { fs.writeFileSync(TRIGGER_FILE, JSON.stringify(msg)); } catch {}
	return json(msg, { status: 201 });
}

/** PATCH /api/chat — mark messages as read */
export async function PATCH({ request }) {
	const { ids } = await request.json();
	if (ids?.length) markAsRead(ids);
	return json({ ok: true });
}
