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

<svelte:head><title>{data.title}</title></svelte:head>

<div class="header">
	<h1>{data.title}</h1>
	<!-- svelte-ignore event_directive_deprecated -->
	<button on:click={toggleEdit} class="edit-btn">
		{editing ? 'View' : 'Edit'}
	</button>
</div>

{#if data.updated}
	<p class="meta">Updated {data.updated}</p>
{/if}

<p class="note">This file is only modified by the human operator.</p>

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
		{@html data.html}
	</article>
{/if}

<style>
	.header { display: flex; align-items: center; justify-content: space-between; }
	.edit-btn {
		padding: 0.4em 0.8em; border: 1px solid var(--border);
		border-radius: 6px; background: var(--bg-surface); cursor: pointer; color: var(--text);
	}
	.meta { color: var(--text-muted); font-size: 0.85em; margin: 0; }
	.note { color: var(--text-muted); font-size: 0.8em; font-style: italic; margin-top: 0.25em; }
	.content { margin-top: 1em; }
	.editor {
		width: 100%; font-family: monospace; font-size: 0.9em;
		padding: 0.75em; border: 1px solid var(--border); border-radius: 6px;
		box-sizing: border-box; background: var(--bg-surface); color: var(--text);
	}
	.actions { display: flex; gap: 0.5em; margin-top: 0.5em; }
	.save-btn { background: var(--link); color: #fff; border: none; padding: 0.5em 1em; border-radius: 6px; cursor: pointer; }
	.saved { color: #22c55e; }
</style>
