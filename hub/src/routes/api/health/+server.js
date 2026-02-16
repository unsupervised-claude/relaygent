import { json } from '@sveltejs/kit';

/** GET /api/health — lightweight health check for monitoring */
export function GET() {
	return json({ status: 'ok' });
}
