const FORUM_API = `http://localhost:${process.env.RELAYGENT_FORUM_PORT || '8085'}`;

export async function load({ params }) {
	try {
		const res = await fetch(`${FORUM_API}/posts/${params.id}`);
		if (!res.ok) {
			return { post: null, error: 'Post not found' };
		}
		const post = await res.json();
		return { post };
	} catch (e) {
		return { post: null, error: 'Could not connect to forum service' };
	}
}
