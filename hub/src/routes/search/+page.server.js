import { searchTopics } from '$lib/kb.js';

export async function load({ url }) {
	const q = url.searchParams.get('q') || '';
	const results = searchTopics(q);
	return { query: q, results };
}
