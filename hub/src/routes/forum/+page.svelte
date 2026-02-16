<script>
	let { data } = $props();

	const categories = ['discussion', 'proposal', 'question', 'idea'];
	const categoryColors = {
		discussion: '#6b7280', proposal: '#8b5cf6',
		question: '#f59e0b', idea: '#10b981'
	};

	function formatDate(isoString) {
		const date = new Date(isoString.endsWith('Z') ? isoString : isoString + 'Z');
		const now = new Date();
		const diffMs = now - date;
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays < 7) return `${diffDays}d ago`;
		return date.toLocaleDateString();
	}
</script>

<svelte:head><title>Forum</title></svelte:head>

<div class="header">
	<h1>Forum</h1>
	<a href="/forum/new" class="new-post-btn">New Post</a>
</div>

{#if data.error}
	<div class="error">{data.error}</div>
{/if}

<div class="stats-bar">
	<span>{data.stats.total_posts} posts</span>
	<span>{data.stats.total_comments} comments</span>
	<span>{data.stats.total_votes} votes</span>
</div>

<div class="filters">
	<div class="categories">
		<a href="/forum" class:active={!data.category}>All</a>
		{#each categories as cat}
			<a href="/forum?category={cat}" class:active={data.category === cat} style="--cat-color: {categoryColors[cat]}">{cat}</a>
		{/each}
	</div>
	<div class="sort">
		<a href="/forum?sort=recent{data.category ? '&category=' + data.category : ''}" class:active={data.sort === 'recent'}>Recent</a>
		<a href="/forum?sort=top{data.category ? '&category=' + data.category : ''}" class:active={data.sort === 'top'}>Top</a>
		<a href="/forum?sort=hot{data.category ? '&category=' + data.category : ''}" class:active={data.sort === 'hot'}>Hot</a>
	</div>
</div>

<div class="posts">
	{#each data.posts as post}
		<article class="post">
			<div class="score">
				<span class="score-value">{post.score}</span>
			</div>
			<div class="content">
				<a href="/forum/{post.id}" class="title">{post.title}</a>
				<div class="meta">
					<span class="category" style="background: {categoryColors[post.category]}">{post.category}</span>
					{#if post.tags && post.tags.length > 0}
						{#each post.tags as tag}
							<a href="/forum?tag={tag}" class="tag">#{tag}</a>
						{/each}
					{/if}
					<span class="author">{post.author}</span>
					<span class="time">{formatDate(post.created_at)}</span>
					<span class="comments">{post.comment_count} comment{post.comment_count !== 1 ? 's' : ''}</span>
					{#if post.citation_count > 0}
						<span class="citations">{post.citation_count} citation{post.citation_count !== 1 ? 's' : ''}</span>
					{/if}
				</div>
			</div>
		</article>
	{:else}
		<p class="empty">No posts yet. Be the first to start a discussion!</p>
	{/each}
</div>

<style>
	.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1em; }
	h1 { margin: 0; }
	.new-post-btn {
		background: var(--link); color: white; padding: 0.5em 1em;
		border-radius: 6px; font-weight: 500;
	}
	.new-post-btn:hover { opacity: 0.9; text-decoration: none; }
	.error { background: #fee2e2; color: #dc2626; padding: 0.75em 1em; border-radius: 6px; margin-bottom: 1em; }
	.stats-bar { display: flex; gap: 1.5em; color: var(--text-muted); font-size: 0.9em; margin-bottom: 1em; }
	.filters {
		display: flex; justify-content: space-between; align-items: center;
		margin-bottom: 1.5em; flex-wrap: wrap; gap: 0.5em;
	}
	.categories, .sort { display: flex; gap: 0.5em; }
	.categories a, .sort a {
		padding: 0.3em 0.75em; border-radius: 15px; font-size: 0.85em;
		color: var(--text-muted); background: var(--code-bg);
	}
	.categories a:hover, .sort a:hover { opacity: 0.8; text-decoration: none; }
	.categories a.active { background: var(--cat-color, var(--link)); color: white; }
	.sort a.active { background: var(--text); color: var(--bg); }
	.posts { display: flex; flex-direction: column; gap: 0.5em; }
	.post {
		display: flex; gap: 1em; padding: 1em; background: var(--bg-surface);
		border-radius: 8px; border: 1px solid var(--border);
	}
	.score { display: flex; flex-direction: column; align-items: center; min-width: 40px; }
	.score-value { font-weight: 600; font-size: 1.1em; color: var(--text-muted); }
	.content { flex: 1; }
	.title { font-weight: 500; font-size: 1.05em; color: var(--text); }
	.title:hover { color: var(--link); }
	.meta {
		display: flex; flex-wrap: wrap; gap: 0.75em;
		margin-top: 0.4em; font-size: 0.85em; color: var(--text-muted);
	}
	.category { padding: 0.15em 0.5em; border-radius: 10px; color: white; font-size: 0.8em; }
	.tag { color: var(--link); font-size: 0.85em; }
	.tag:hover { text-decoration: underline; }
	.citations { color: #059669; font-weight: 500; }
	.empty { color: var(--text-muted); text-align: center; padding: 3em 1em; }
	@media (max-width: 600px) {
		.filters { flex-direction: column; align-items: flex-start; }
		.post { padding: 0.75em; }
		.score { min-width: 30px; }
	}
</style>
