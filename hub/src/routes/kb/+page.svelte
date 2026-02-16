<script>
	let { data } = $props();
	let search = $state('');
	let showTags = $state(false);

	let filtered = $derived(
		search
			? data.topics.filter(t =>
				(t.title || t.slug).toLowerCase().includes(search.toLowerCase()) ||
				(t.tags || []).some(tag => tag.toLowerCase().includes(search.toLowerCase()))
			)
			: data.topics
	);
</script>

<svelte:head><title>Knowledge Base</title></svelte:head>

<h1>Knowledge Base <span class="count">({data.topics.length})</span></h1>

<input type="search" placeholder="Filter topics or tags..." bind:value={search} class="search" />

{#if data.activeTag}
	<div class="active-filter">
		Filtered by <strong>{data.activeTag}</strong> &middot; <a href="/kb">clear</a>
	</div>
{:else}
	<!-- svelte-ignore event_directive_deprecated -->
	<button class="toggle-tags" on:click={() => showTags = !showTags}>
		{showTags ? 'Hide' : 'Show'} tags ({data.allTags.length})
	</button>
{/if}

{#if showTags || data.activeTag}
	<div class="tags">
		{#each data.allTags as tag}
			<a href="/kb?tag={tag}" class="tag" class:active={tag === data.activeTag}>{tag}</a>
		{/each}
	</div>
{/if}

<ul class="topic-list">
	{#each filtered as topic}
		<li>
			<a href="/kb/{topic.slug}">{topic.title || topic.slug}</a>
			{#if topic.updated}<span class="date">{topic.updated}</span>{/if}
		</li>
	{:else}
		<li class="empty">No topics found.</li>
	{/each}
</ul>

{#if data.dailyLogs.length > 0 && !search}
	<h2 class="section-label">Daily Logs</h2>
	<ul class="topic-list">
		{#each data.dailyLogs as log}
			<li>
				<a href="/kb/{log.slug}">{log.slug}</a>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.count { font-weight: 400; color: var(--text-muted); font-size: 0.6em; }
	.search {
		width: 100%;
		padding: 0.6em 0.8em;
		border: 1px solid var(--border);
		border-radius: 6px;
		font-size: 1em;
		margin: 0.5em 0;
		box-sizing: border-box;
		background: var(--bg-surface);
		color: var(--text);
	}
	.active-filter {
		margin: 0.5em 0;
		font-size: 0.9em;
		color: var(--text-muted);
	}
	.toggle-tags {
		background: none;
		border: none;
		color: var(--link);
		cursor: pointer;
		font-size: 0.85em;
		padding: 0.25em 0;
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4em;
		margin: 0.5em 0;
	}
	.tag {
		font-size: 0.8em;
		padding: 0.2em 0.6em;
		background: var(--code-bg);
		border-radius: 12px;
		color: var(--text-muted);
	}
	.tag.active { background: var(--link); color: #fff; }
	.topic-list { list-style: none; padding: 0; }
	.topic-list li {
		display: flex;
		justify-content: space-between;
		padding: 0.4em 0;
		border-bottom: 1px solid var(--border);
	}
	.date { color: var(--text-muted); font-size: 0.85em; }
	.empty { color: var(--text-muted); }
	.section-label { font-size: 1em; color: var(--text-muted); margin-top: 2em; }
</style>
