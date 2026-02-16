const NOTIF_PORT = process.env.RELAYGENT_NOTIFICATIONS_PORT || '8083';
const NOTIF_URL = `http://127.0.0.1:${NOTIF_PORT}`;

export async function load() {
	try {
		const res = await fetch(`${NOTIF_URL}/upcoming`);
		const reminders = await res.json();
		return { reminders, error: null };
	} catch {
		return { reminders: [], error: 'Notifications service unreachable' };
	}
}
