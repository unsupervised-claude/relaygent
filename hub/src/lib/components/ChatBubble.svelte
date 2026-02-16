<script>
	import { onMount, onDestroy, tick } from 'svelte';
	import { browser } from '$app/environment';

	let open = $state(false);
	let messages = $state([]);
	let input = $state('');
	let sending = $state(false);
	let unread = $state(0);
	let hasMore = $state(true);
	let loadingOlder = $state(false);
	let ws = null;
	let chatEl = $state(null);
	let textareaEl = $state(null);
	let autoScroll = true;

	async function loadHistory() {
		try {
			const res = await fetch('/api/chat?limit=50');
			const data = await res.json();
			messages = (data.messages || []).reverse();
			hasMore = data.messages?.length === 50;
			await tick();
			scrollBottom();
		} catch {}
	}

	async function loadOlder() {
		if (loadingOlder || !hasMore || !messages.length) return;
		loadingOlder = true;
		const prev = chatEl?.scrollHeight || 0;
		try {
			const res = await fetch(`/api/chat?limit=50&before=${messages[0].id}`);
			const data = await res.json();
			const older = (data.messages || []).reverse();
			if (older.length < 50) hasMore = false;
			if (older.length) { messages = [...older, ...messages]; await tick(); if (chatEl) chatEl.scrollTop = chatEl.scrollHeight - prev; }
		} catch {}
		loadingOlder = false;
	}

	function onScroll() {
		if (chatEl?.scrollTop < 80) loadOlder();
		if (chatEl) autoScroll = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 60;
	}

	function connect() {
		if (!browser) return;
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		ws = new WebSocket(`${proto}//${location.host}/ws/chat`);
		ws.onmessage = async (e) => {
			const msg = JSON.parse(e.data);
			if (msg.type !== 'message') return;
			messages = [...messages, msg.data];
			if (msg.data.role === 'assistant') {
				if (!open) { open = true; unread = 0; }
				else if (!autoScroll) unread++;
			}
			await tick();
			if (autoScroll || msg.data.role === 'assistant') scrollBottom();
		};
		ws.onclose = () => setTimeout(connect, 3000);
	}

	function scrollBottom() { if (chatEl) chatEl.scrollTop = chatEl.scrollHeight; }

	async function send() {
		const text = input.trim();
		if (!text || sending) return;
		sending = true; input = '';
		if (textareaEl) textareaEl.style.height = 'auto';
		try {
			await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text, role: 'human' }) });
		} catch {}
		sending = false;
	}

	function onKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }

	function resize(e) {
		const el = e.target; el.style.height = 'auto';
		const max = (parseFloat(getComputedStyle(el).lineHeight) || 20) * 4 + 20;
		el.style.height = Math.min(el.scrollHeight, max) + 'px';
	}

	function fmtTime(iso) {
		return new Date(iso.endsWith('Z') ? iso : iso + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	function toggle() { open = !open; if (open) { unread = 0; tick().then(scrollBottom); } }

	onMount(() => { loadHistory(); connect(); });
	onDestroy(() => { if (ws) ws.close(); });
</script>

<div class="cb-wrap">
	{#if open}
		<div class="cb-panel">
			<div class="cb-header"><span>Chat</span><button class="cb-close" onclick={toggle}>&times;</button></div>
			<div class="cb-msgs" bind:this={chatEl} onscroll={onScroll}>
				{#if loadingOlder}<div class="cb-loading">Loading...</div>{/if}
				{#each messages as m}
					<div class="cb-msg" class:human={m.role==='human'} class:bot={m.role==='assistant'}>
						<div class="cb-bub"><span>{m.content}</span><span class="cb-time">{fmtTime(m.created_at)}</span></div>
					</div>
				{:else}<div class="cb-empty">No messages yet</div>{/each}
			</div>
			<div class="cb-inp">
				<textarea bind:this={textareaEl} bind:value={input} onkeydown={onKey} oninput={resize} placeholder="Message..." rows="1" disabled={sending}></textarea>
				<button onclick={send} disabled={sending||!input.trim()} aria-label="Send message">
					<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
				</button>
			</div>
		</div>
	{/if}
	<button class="cb-fab" onclick={toggle} aria-label="Toggle chat">
		{#if open}
			<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
		{:else}
			<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
		{/if}
		{#if unread > 0 && !open}<span class="cb-badge">{unread > 9 ? '9+' : unread}</span>{/if}
	</button>
</div>

<style>
	.cb-wrap { position: fixed; bottom: 1.5em; right: 1.5em; z-index: 1000; }
	.cb-fab {
		width: 56px; height: 56px; border-radius: 50%; background: var(--link, #2563eb); color: white;
		border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;
		box-shadow: 0 4px 12px rgba(0,0,0,0.25); position: relative; transition: transform 0.15s;
	}
	.cb-fab:hover { transform: scale(1.05); box-shadow: 0 6px 20px rgba(0,0,0,0.3); }
	.cb-badge {
		position: absolute; top: -4px; right: -4px; background: #ef4444; color: white;
		font-size: 0.7em; font-weight: 700; min-width: 18px; height: 18px; border-radius: 9px;
		display: flex; align-items: center; justify-content: center; padding: 0 4px;
	}
	.cb-panel {
		position: absolute; bottom: 70px; right: 0; width: 380px; height: 600px; max-height: calc(100vh - 120px);
		background: var(--bg-surface, #fff); border: 1px solid var(--border, #e5e5e5);
		border-radius: 12px; overflow: hidden; box-shadow: 0 8px 30px rgba(0,0,0,0.15);
		display: flex; flex-direction: column; animation: cbSlide 0.2s ease-out;
	}
	@keyframes cbSlide { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
	.cb-header {
		display: flex; align-items: center; justify-content: space-between;
		padding: 0.65em 1em; background: var(--link, #2563eb); color: white; font-weight: 600; font-size: 0.95em;
	}
	.cb-close { background: none; border: none; color: white; font-size: 1.4em; cursor: pointer; padding: 0; line-height: 1; opacity: 0.8; }
	.cb-close:hover { opacity: 1; }
	.cb-msgs { flex: 1; overflow-y: auto; padding: 0.75em; display: flex; flex-direction: column; gap: 0.35em; }
	.cb-loading { text-align: center; font-size: 0.75em; color: var(--text-muted, #555); }
	.cb-msg { display: flex; }
	.cb-msg.human { justify-content: flex-end; }
	.cb-msg.bot { justify-content: flex-start; }
	.cb-bub { max-width: 80%; padding: 0.35em 0.6em; border-radius: 14px; line-height: 1.35; word-wrap: break-word; white-space: pre-wrap; font-size: 0.85em; }
	.cb-msg.human .cb-bub { background: var(--link, #2563eb); color: white; border-bottom-right-radius: 4px; }
	.cb-msg.bot .cb-bub { background: var(--code-bg, #f0f0f0); color: var(--text, #1a1a1a); border-bottom-left-radius: 4px; }
	.cb-time { display: inline; float: right; font-size: 0.6em; opacity: 0.5; margin-left: 0.5em; margin-top: 0.3em; }
	.cb-empty { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--text-muted, #555); font-style: italic; font-size: 0.85em; }
	.cb-inp { display: flex; gap: 0.4em; padding: 0.5em; border-top: 1px solid var(--border, #e5e5e5); background: var(--bg, #fafafa); }
	.cb-inp textarea {
		flex: 1; padding: 0.45em 0.6em; border: 1px solid var(--border, #e5e5e5); border-radius: 8px;
		font-family: inherit; font-size: 0.85em; resize: none; background: var(--bg-surface, #fff);
		color: var(--text, #1a1a1a); min-height: 2.2em; overflow-y: hidden;
	}
	.cb-inp textarea:focus { outline: none; border-color: var(--link, #2563eb); }
	.cb-inp button {
		width: 34px; height: 34px; background: var(--link, #2563eb); color: white; border: none;
		border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; align-self: flex-end;
	}
	.cb-inp button:hover:not(:disabled) { opacity: 0.9; }
	.cb-inp button:disabled { opacity: 0.4; cursor: not-allowed; }
	@media (max-width: 500px) {
		.cb-panel { width: calc(100vw - 2em); right: -0.5em; bottom: 65px; height: 75vh; }
		.cb-wrap { bottom: 1em; right: 1em; }
	}
</style>
