<script>
	let { data, form } = $props();
	let editing = $state(false);
	let editContent = $state('');

	function toggleEdit() {
		editing = !editing;
		if (editing) editContent = data.rawContent;
	}

	$effect(() => {
		if (form?.success) editing = false;
	});
</script>

<svelte:head><title>{data.topic.title || data.topic.slug}</title></svelte:head>

<div class="header">
	<h1>{data.topic.title || data.topic.slug}</h1>
	<!-- svelte-ignore event_directive_deprecated -->
	<button on:click={toggleEdit} class="edit-btn">
		{editing ? 'View' : 'Edit'}
	</button>
</div>

{#if data.topic.tags?.length}
	<div class="tags">
		{#each data.topic.tags as tag}
			<a href="/kb?tag={tag}" class="tag">{tag}</a>
		{/each}
	</div>
{/if}

{#if data.topic.updated}
	<p class="meta">Updated {data.topic.updated}</p>
{/if}

{#if editing}
	<form method="POST" action="?/save">
		<textarea name="content" bind:value={editContent} rows="20" class="editor"></textarea>
		<div class="actions">
			<button type="submit" class="save-btn">Save</button>
			<!-- svelte-ignore event_directive_deprecated -->
			<button type="button" on:click={() => editing = false}>Cancel</button>
		</div>
	</form>
	{#if form?.success}<p class="saved">Saved.</p>{/if}
{:else}
	<article class="content">
		{@html data.topic.html}
	</article>
{/if}

{#if data.topic.backlinks?.length}
	<section class="backlinks">
		<h3>Backlinks</h3>
		<ul>
			{#each data.topic.backlinks as bl}
				<li><a href="/kb/{bl.slug}">{bl.title}</a></li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.header { display: flex; align-items: center; justify-content: space-between; }
	.edit-btn {
		padding: 0.4em 0.8em; border: 1px solid var(--border);
		border-radius: 6px; background: var(--bg-surface); cursor: pointer; color: var(--text);
	}
	.tags { display: flex; gap: 0.4em; margin-bottom: 0.5em; }
	.tag {
		font-size: 0.8em; padding: 0.2em 0.6em;
		background: var(--code-bg); border-radius: 12px; color: var(--text-muted);
	}
	.meta { color: var(--text-muted); font-size: 0.85em; margin: 0; }
	.content { margin-top: 1em; }
	.editor {
		width: 100%; font-family: monospace; font-size: 0.9em;
		padding: 0.75em; border: 1px solid var(--border); border-radius: 6px;
		box-sizing: border-box; background: var(--bg-surface); color: var(--text);
	}
	.actions { display: flex; gap: 0.5em; margin-top: 0.5em; }
	.save-btn { background: var(--link); color: #fff; border: none; padding: 0.5em 1em; border-radius: 6px; cursor: pointer; }
	.saved { color: #22c55e; }
	.backlinks { margin-top: 2em; padding-top: 1em; border-top: 1px solid var(--border); }
	.backlinks ul { padding-left: 1.2em; }
</style>
