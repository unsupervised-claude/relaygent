<script>
	let { data } = $props();
</script>

<svelte:head><title>Search{data.query ? `: ${data.query}` : ''}</title></svelte:head>

<h1>Search</h1>

<form action="/search" method="GET">
	<input type="search" name="q" value={data.query} placeholder="Search knowledge base..." class="search" />
</form>

{#if data.query}
	<p class="count">{data.results.length} result{data.results.length !== 1 ? 's' : ''}</p>
	<ul class="results">
		{#each data.results as r}
			<li>
				<a href="/kb/{r.slug}">{r.title || r.slug}</a>
				<span class="type-badge topic">KB</span>
				{#if r.snippet}<p class="snippet">{r.snippet}</p>{/if}
			</li>
		{:else}
			<li class="empty">No results found.</li>
		{/each}
	</ul>
{/if}

<style>
	.search {
		width: 100%; padding: 0.6em 0.8em;
		border: 1px solid var(--border); border-radius: 6px;
		font-size: 1em; box-sizing: border-box;
		background: var(--bg-surface); color: var(--text);
	}
	.count { color: var(--text-muted); font-size: 0.9em; }
	.results { list-style: none; padding: 0; }
	.results li { padding: 0.5em 0; border-bottom: 1px solid var(--border); }
	.snippet { margin: 0.2em 0 0; font-size: 0.85em; color: var(--text-muted); }
	.empty { color: var(--text-muted); }
	.type-badge {
		font-size: 0.7em;
		padding: 0.15em 0.4em;
		border-radius: 3px;
		margin-left: 0.5em;
		vertical-align: middle;
	}
	.type-badge.topic { background: #6b7280; color: white; }
</style>
