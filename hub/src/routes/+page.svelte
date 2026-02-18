<script>
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import ContextBar from '$lib/components/ContextBar.svelte';
	import ActivityFeed from '$lib/components/ActivityFeed.svelte';
	import ScreenStream from '$lib/components/ScreenStream.svelte';
	import { sanitizeHtml } from '$lib/sanitize.js';

	let { data } = $props();
	let screenOpen = $state(false);
	let activities = $state(data.relayActivity || []);
	let connected = $state(false);
	let contextPct = $state(data.contextPct);
	let attentionItems = $state(data.attentionItems || []);
	let sessionStatus = $state(data.relayActivity?.length > 0 ? 'found' : 'waiting');
	let ws = null;
	let loading = $state(false), hasMore = $state(true);
	let currentModel = $state(data.currentModel || '');
	let modelSaving = $state(false);
	let hookCtx = $state('');

	const MODEL_OPTIONS = [
		{ id: 'claude-opus-4-6', label: 'Opus 4.6' },
		{ id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
		{ id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5' },
		{ id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
	];

	async function setModel(e) {
		const model = e.target.value;
		modelSaving = true;
		try {
			const res = await fetch('/api/model', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ model }),
			});
			if (res.ok) currentModel = model;
		} catch { /* ignore */ }
		modelSaving = false;
	}

	async function reloadPageData() {
		try {
			const res = await fetch(`/api/relay?offset=0&limit=50`);
			const d = await res.json();
			if (d.activities?.length > 0) activities = d.activities;
		} catch { /* ignore */ }
	}

	function connect() {
		if (!browser) return;
		const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		ws = new WebSocket(`${proto}//${window.location.host}/ws/relay`);
		ws.onopen = () => { connected = true; };
		ws.onclose = () => { connected = false; setTimeout(connect, 3000); };
		ws.onmessage = (event) => {
			const msg = JSON.parse(event.data);
			if (msg.type === 'activity') {
				sessionStatus = 'found';
				activities = [{ ...msg.data, isNew: true }, ...activities].slice(0, 100);
				setTimeout(() => { activities = activities.map((a, i) => i === 0 ? { ...a, isNew: false } : a); }, 500);
			} else if (msg.type === 'result' && msg.toolUseId) {
				activities = activities.map(a => a.toolUseId === msg.toolUseId ? { ...a, result: msg.result, fullResult: msg.fullResult } : a);
			} else if (msg.type === 'context') { contextPct = msg.pct; }
			else if (msg.type === 'hook') { hookCtx = msg.data?.context || ''; }
			else if (msg.type === 'session') {
				sessionStatus = msg.status;
				if (msg.status === 'found') reloadPageData();
			}
		};
	}

	async function loadMore() {
		if (loading || !hasMore) return;
		loading = true;
		try {
			const d = await (await fetch(`/api/relay?offset=${activities.length}&limit=20`)).json();
			if (d.activities.length > 0) activities = [...activities, ...d.activities];
			hasMore = d.hasMore;
		} catch (e) { console.error('Load failed:', e); }
		loading = false;
	}

	function handleScroll() {
		const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
		if (scrollTop + clientHeight >= scrollHeight - 200) loadMore();
	}

	onMount(() => { connect(); if (browser) window.addEventListener('scroll', handleScroll); });
	onDestroy(() => { if (ws) ws.close(); if (browser) window.removeEventListener('scroll', handleScroll); });

	function clearAttentionItem(index) { attentionItems = attentionItems.filter((_, i) => i !== index); }
	function clearAllAttention() { attentionItems = []; }
</script>

<svelte:head><title>Relaygent</title></svelte:head>

<section class="status-bar">
	<div class="status-item">
		<span class="indicator" class:pulse={connected}></span>
		<span class="relay-label">Relay</span>
		<span class="badge" class:on={connected}>{connected ? 'Live' : 'Offline'}</span>
	</div>
	<div class="model-picker">
		<select value={currentModel} onchange={setModel} disabled={modelSaving}>
			<option value="" disabled>Model...</option>
			{#each MODEL_OPTIONS as opt}
				<option value={opt.id}>{opt.label}</option>
			{/each}
		</select>
	</div>
	{#if data.services?.length}
	<div class="svc-row">
		{#each data.services as svc}
			<span class="svc" class:up={svc.ok} class:down={!svc.ok} title={svc.detail || ''}>
				<span class="dot"></span>{svc.name}
			</span>
		{/each}
	</div>
	{/if}
</section>

{#if hookCtx}
<div class="hook-ctx">{hookCtx}</div>
{/if}

{#if data.mainGoal}
<section class="goal">
	<div class="gl">Focus</div>
	<div class="gt">{data.mainGoal}</div>
</section>
{/if}

<ContextBar pct={contextPct} />

<section class="screen-toggle">
	<button class="toggle-btn" onclick={() => screenOpen = !screenOpen}>
		<span class="toggle-arrow">{screenOpen ? '\u25BC' : '\u25B6'}</span>
		Screen
	</button>
	{#if screenOpen}
		<div class="screen-wrap"><ScreenStream fps={4} /></div>
	{/if}
</section>

{#if attentionItems?.length > 0}
<section class="attention">
	<div class="att-hdr"><h3>Attention</h3><button class="clear-all" onclick={clearAllAttention}>Clear</button></div>
	{#each attentionItems as item, i}
		<div class="att-item"><span>{@html sanitizeHtml(item)}</span><button class="x" onclick={() => clearAttentionItem(i)}>x</button></div>
	{/each}
</section>
{/if}

{#if sessionStatus === 'waiting' && activities.length === 0}
<section class="waiting">
	<div class="waiting-icon">&#9203;</div>
	<div class="waiting-text">Waiting for relay agent to start...</div>
	<div class="waiting-hint">The dashboard will update automatically when the agent begins working.</div>
</section>
{:else}
<ActivityFeed {activities} {loading} {hasMore} onLoadMore={loadMore} />
{/if}

<style>
	.status-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75em; padding: 0.6em 1em; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 1em; }
	.status-item { display: flex; align-items: center; gap: 0.5em; }  .relay-label { font-weight: 600; color: var(--text); }
	.indicator { width: 8px; height: 8px; border-radius: 50%; background: var(--text-muted); }
	.indicator.pulse { background: #22c55e; animation: pulse 2s infinite; }
	@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
	.badge { font-size: 0.75em; padding: 0.15em 0.5em; border-radius: 10px; background: #fee2e2; color: #dc2626; }  .badge.on { background: #dcfce7; color: #16a34a; }
	.hook-ctx { font-size: 0.72em; color: var(--text-muted); padding: 0.3em 1em; background: var(--code-bg); border-radius: 6px; margin-bottom: 0.75em; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.model-picker select { background: var(--bg-surface); color: var(--text); border: 1px solid var(--border); border-radius: 4px; padding: 0.2em 0.4em; font-size: 0.78em; cursor: pointer; }
	.model-picker select:hover { border-color: var(--text-muted); }  .model-picker select:disabled { opacity: 0.5; cursor: wait; }
	.svc-row { display: flex; flex-wrap: wrap; gap: 0.4em 0.8em; margin-left: auto; }
	.svc { display: flex; align-items: center; gap: 0.3em; font-size: 0.78em; color: var(--text-muted); }
	.svc .dot { width: 5px; height: 5px; border-radius: 50%; }
	.svc.up .dot { background: #22c55e; } .svc.down .dot { background: #ef4444; } .svc.down { color: #ef4444; }
	.goal { display: flex; align-items: baseline; gap: 0.75em; padding: 0.5em 1em; background: color-mix(in srgb, var(--link) 8%, var(--bg-surface)); border: 1px solid color-mix(in srgb, var(--link) 25%, var(--border)); border-radius: 8px; margin-bottom: 1em; }
	.gl { font-weight: 700; font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--link); white-space: nowrap; }
	.gt { color: var(--text); font-size: 0.88em; line-height: 1.4; }
	.attention { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 0.75em 1em; margin-bottom: 1em; }
	.att-hdr { display: flex; justify-content: space-between; align-items: center; }
	.attention h3 { margin: 0 0 0.3em; font-size: 0.9em; color: var(--text-muted); }
	.att-item { display: flex; justify-content: space-between; gap: 0.5em; padding: 0.4em 0.6em; background: var(--code-bg); border-radius: 4px; margin-bottom: 0.3em; font-size: 0.88em; }
	.att-item :global(strong) { color: var(--link); }
	.x, .clear-all { background: none; border: none; color: var(--text-muted); cursor: pointer; }  .x:hover, .clear-all:hover { color: var(--text); }
	.clear-all { font-size: 0.75em; border: 1px solid var(--border); padding: 0.2em 0.4em; border-radius: 4px; }
	.waiting { text-align: center; padding: 3em 1em; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 1em; }
	.waiting-icon { font-size: 2em; margin-bottom: 0.5em; animation: pulse 2s infinite; }
	.waiting-text { font-size: 1.1em; font-weight: 600; color: var(--text); margin-bottom: 0.3em; }
	.waiting-hint { font-size: 0.85em; color: var(--text-muted); }  .screen-toggle { margin-bottom: 1em; }
	.toggle-btn { display: flex; align-items: center; gap: 0.4em; background: none; border: 1px solid var(--border); border-radius: 6px; padding: 0.3em 0.7em; font-size: 0.82em; font-weight: 600; color: var(--text-muted); cursor: pointer; }
	.toggle-btn:hover { color: var(--text); border-color: var(--text-muted); }  .toggle-arrow { font-size: 0.7em; }
	.screen-wrap { margin-top: 0.5em; }
	@media (max-width: 768px) {
		.goal { flex-direction: column; gap: 0.25em; }
	}
</style>
