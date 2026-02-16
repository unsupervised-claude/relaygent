import { listTopics } from '$lib/kb.js';

export function load({ url }) {
	const tag = url.searchParams.get('tag');
	const all = listTopics();

	// Separate daily logs from regular topics
	const isDaily = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t.slug);
	const dailyLogs = all.filter(isDaily);
	let topics = all.filter(t => !isDaily(t));

	const allTags = [...new Set(topics.flatMap(t => t.tags || []))].sort();

	if (tag) {
		topics = topics.filter(t => (t.tags || []).includes(tag));
	}

	return { topics, dailyLogs, allTags, activeTag: tag };
}
