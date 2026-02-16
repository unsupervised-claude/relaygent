import { searchTopics, searchForum } from '$lib/kb.js';

export async function load({ url }) {
	const q = url.searchParams.get('q') || '';
	const topicResults = searchTopics(q);
	const forumResults = await searchForum(q);
	// Combine results: forum posts first (more recent), then topics
	const results = [...forumResults, ...topicResults];
	return { query: q, results };
}
