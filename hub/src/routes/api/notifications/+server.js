import { json } from '@sveltejs/kit';

const NOTIF_PORT = process.env.RELAYGENT_NOTIFICATIONS_PORT || '8083';
const NOTIF_URL = `http://127.0.0.1:${NOTIF_PORT}`;

async function proxy(path, method = 'GET', body = null) {
	const opts = { method, headers: { 'Content-Type': 'application/json' } };
	if (body) opts.body = JSON.stringify(body);
	const res = await fetch(`${NOTIF_URL}${path}`, opts);
	return res.json();
}

/** GET /api/notifications — list upcoming reminders */
export async function GET() {
	try {
		const reminders = await proxy('/upcoming');
		return json({ reminders });
	} catch (e) {
		return json({ reminders: [], error: 'Notifications service unreachable' });
	}
}

/** POST /api/notifications — create a reminder */
export async function POST({ request }) {
	const data = await request.json();
	if (!data.trigger_time || !data.message) {
		return json({ error: 'trigger_time and message required' }, { status: 400 });
	}
	try {
		const result = await proxy('/reminder', 'POST', data);
		return json(result, { status: 201 });
	} catch (e) {
		return json({ error: 'Notifications service unreachable' }, { status: 502 });
	}
}

/** DELETE /api/notifications — cancel a reminder by id */
export async function DELETE({ url }) {
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'id required' }, { status: 400 });
	try {
		const result = await proxy(`/reminder/${id}`, 'DELETE');
		return json(result);
	} catch (e) {
		return json({ error: 'Notifications service unreachable' }, { status: 502 });
	}
}
