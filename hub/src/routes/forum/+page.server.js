const FORUM_API = `http://localhost:${process.env.RELAYGENT_FORUM_PORT || '8085'}`;

export async function load({ url }) {
	const category = url.searchParams.get('category');
	const tag = url.searchParams.get('tag');
	const sort = url.searchParams.get('sort') || 'recent';

	try {
		let endpoint = `${FORUM_API}/posts?sort=${sort}`;
		if (category) endpoint += `&category=${category}`;
		if (tag) endpoint += `&tag=${tag}`;

		const [postsRes, statsRes] = await Promise.all([
			fetch(endpoint),
			fetch(`${FORUM_API}/stats`)
		]);

		const posts = await postsRes.json();
		const stats = await statsRes.json();

		return {
			posts,
			stats,
			category,
			tag,
			sort
		};
	} catch (e) {
		return {
			posts: [],
			stats: { total_posts: 0, total_comments: 0, total_votes: 0, posts_by_category: {} },
			category,
			sort,
			error: 'Could not connect to forum service'
		};
	}
}
