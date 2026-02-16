<script>
	let { activities = [], loading = false, hasMore = true, onLoadMore } = $props();
	let now = $state(Date.now());
	let expandedKey = $state(null);

	function itemKey(item) {
		return item.toolUseId || `${item.time}-${item.name || item.type}`;
	}
	let filter = $state('all');

	const filters = [
		{ key: 'all', label: 'All' }, { key: 'file', label: 'Files' },
		{ key: 'bash', label: 'Bash' }, { key: 'mcp', label: 'MCP' }, { key: 'text', label: 'Text' },
	];

	$effect(() => { const id = setInterval(() => { now = Date.now(); }, 1000); return () => clearInterval(id); });

	function relTime(ts) {
		const d = Math.floor((now - new Date(ts).getTime()) / 1000);
		if (d < 5) return 'now'; if (d < 60) return `${d}s`; if (d < 3600) return `${Math.floor(d/60)}m`;
		return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	function cat(n) {
		if (!n) return 'other';
		if (['Read','Edit','Write','Glob','Grep'].includes(n)) return 'file';
		if (n === 'Bash') return 'bash';
		if (n.startsWith('mcp__')) return 'mcp';
		return 'other';
	}

	function shortName(n) {
		if (!n.startsWith('mcp__')) return n;
		const parts = n.replace('mcp__', '').split('__');
		const svc = parts[0];
		const op = (parts[1] || '').replace(`${parts[0]}_`, '');
		return `${svc}.${op}`;
	}

	function fmtParams(params) {
		if (!params || !Object.keys(params).length) return '';
		return Object.entries(params)
			.filter(([, v]) => v !== undefined && v !== null)
			.map(([k, v]) => {
				const val = typeof v === 'string' ? v :
					Array.isArray(v) ? JSON.stringify(v, null, 2) : JSON.stringify(v);
				return `${k}: ${val}`;
			}).join('\n');
	}

	let filtered = $derived(filter === 'all' ? activities : activities.filter(a =>
		filter === 'text' ? a.type === 'text' : a.type === 'tool' && cat(a.name) === filter));
</script>

<section class="feed-section">
	<div class="fbar">
		{#each filters as f}<button class="fb" class:active={filter === f.key} onclick={() => filter = f.key}>{f.label}</button>{/each}
		<span class="cnt">{filtered.length}</span>
	</div>
	<div class="feed">
		{#each filtered as item (itemKey(item))}
			{@const expanded = expandedKey === itemKey(item)}
			<div class="ai {item.type} {cat(item.name)}" class:new={item.isNew} class:expanded
				onclick={() => expandedKey = expanded ? null : itemKey(item)}>
				<span class="time">{relTime(item.time)}</span>
				{#if item.type === 'tool'}
					<div class="tc">
						<span class="tn">{item.name?.startsWith('mcp__') ? shortName(item.name) : item.name}</span>
						{#if item.input && !expanded}<span class="ti">{item.input.length > 70 ? item.input.slice(0, 70) + '...' : item.input}</span>{/if}
					</div>
					{#if expanded}
						<div class="detail" style="grid-column: 2">
							{#if item.params && Object.keys(item.params).length}
								<div class="detail-section">
									<span class="detail-label">Params</span>
									<pre class="detail-pre">{fmtParams(item.params)}</pre>
								</div>
							{/if}
							{#if item.fullResult || item.result}
								<div class="detail-section">
									<span class="detail-label">Result</span>
									<pre class="detail-pre">{item.fullResult || item.result}</pre>
								</div>
							{/if}
							{#if !item.params && !item.result && !item.fullResult}
								<span class="detail-empty">No details available</span>
							{/if}
						</div>
					{/if}
				{:else}
					<span class="tx">{expanded ? item.text : (item.text.length > 100 ? item.text.slice(0, 100) + '...' : item.text)}</span>
				{/if}
			</div>
		{/each}
	</div>
	{#if loading}<div class="end">Loading...</div>
	{:else if !hasMore && activities.length > 15}<div class="end">End of session</div>{/if}
</section>

<style>
	.feed-section { margin-bottom: 1.5em; }
	.fbar { display: flex; gap: 0.3em; align-items: center; margin-bottom: 0.5em; }
	.fb { padding: 0.2em 0.5em; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-surface); color: var(--text-muted); cursor: pointer; font-size: 0.78em; }
	.fb.active { background: var(--link); color: white; border-color: var(--link); }
	.cnt { margin-left: auto; font-size: 0.78em; color: var(--text-muted); }
	.feed { display: flex; flex-direction: column; gap: 0.25em; }
	.ai { display: grid; grid-template-columns: 2.5em 1fr; gap: 0.4em; font-size: 0.85em; padding: 0.35em 0.5em; background: var(--bg-surface); border-radius: 4px; border-left: 3px solid var(--border); cursor: pointer; transition: background 0.15s; }
	.ai:hover { background: var(--code-bg); }
	.ai.expanded { background: var(--code-bg); }
	.ai.new { animation: fadeIn 0.3s ease-out; background: var(--code-bg); }
	@keyframes fadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; } }
	.ai.text { border-left-color: #22c55e; }
	.ai.file { border-left-color: #3b82f6; }
	.ai.bash { border-left-color: #f59e0b; }
	.ai.mcp { border-left-color: #8b5cf6; }
	.ai.other { border-left-color: #6b7280; }
	.time { color: var(--text-muted); font-size: 0.78em; font-family: monospace; white-space: nowrap; }
	.tc { display: flex; flex-wrap: wrap; gap: 0.3em; align-items: baseline; min-width: 0; }
	.tn { font-weight: 600; font-family: monospace; white-space: nowrap; font-size: 0.92em; }
	.file .tn { color: #3b82f6; } .bash .tn { color: #f59e0b; } .mcp .tn { color: #8b5cf6; } .other .tn { color: #6b7280; }
	.ti { color: var(--text-muted); font-family: monospace; font-size: 0.88em; word-break: break-word; }
	.tx { color: var(--text); line-height: 1.4; min-width: 0; word-break: break-word; }
	.detail { margin-top: 0.3em; }
	.detail-section { margin-bottom: 0.4em; }
	.detail-label { font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); font-weight: 600; }
	.detail-pre { margin: 0.15em 0 0; padding: 0.4em 0.6em; background: var(--bg); border-radius: 4px; font-size: 0.82em; white-space: pre-wrap; word-break: break-word; color: var(--text); border: 1px solid var(--border); max-height: 200px; overflow-y: auto; }
	.detail-empty { font-size: 0.8em; color: var(--text-muted); font-style: italic; }
	.end { text-align: center; padding: 1em; color: var(--text-muted); font-size: 0.85em; }
</style>
