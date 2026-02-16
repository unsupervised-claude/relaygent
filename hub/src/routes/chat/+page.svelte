<script>
	import { onMount, onDestroy, tick } from 'svelte';
	import { browser } from '$app/environment';

	let messages = $state([]);
	let input = $state('');
	let sending = $state(false);
	let loadingOlder = $state(false);
	let hasMore = $state(true);
	let ws = null;
	let chatEl;

	async function loadHistory() {
		try {
			const res = await fetch('/api/chat?limit=50');
			const data = await res.json();
			messages = (data.messages || []).reverse();
			hasMore = data.messages?.length === 50;
			await tick();
			scrollToBottom();
		} catch (e) { console.error('Failed to load chat:', e); }
	}

	async function loadOlder() {
		if (loadingOlder || !hasMore || !messages.length) return;
		loadingOlder = true;
		const oldestId = messages[0].id;
		const prevHeight = chatEl.scrollHeight;
		try {
			const res = await fetch(`/api/chat?limit=50&before=${oldestId}`);
			const data = await res.json();
			const older = (data.messages || []).reverse();
			if (older.length < 50) hasMore = false;
			if (older.length) {
				messages = [...older, ...messages];
				await tick();
				chatEl.scrollTop = chatEl.scrollHeight - prevHeight;
			}
		} catch (e) { console.error('Failed to load older:', e); }
		loadingOlder = false;
	}

	function handleScroll() {
		if (chatEl && chatEl.scrollTop < 80) loadOlder();
	}

	function connect() {
		if (!browser) return;
		const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		ws = new WebSocket(`${proto}//${window.location.host}/ws/chat`);
		ws.onmessage = async (event) => {
			const msg = JSON.parse(event.data);
			if (msg.type === 'message') {
				messages = [...messages, msg.data];
				await tick();
				scrollToBottom();
			}
		};
		ws.onclose = () => { setTimeout(connect, 3000); };
	}

	function scrollToBottom() {
		if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
	}

	let textareaEl;

	async function send() {
		const text = input.trim();
		if (!text || sending) return;
		sending = true;
		input = '';
		if (textareaEl) textareaEl.style.height = 'auto';
		try {
			await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: text, role: 'human' })
			});
		} catch (e) { console.error('Send failed:', e); }
		sending = false;
	}

	function handleKeydown(e) {
		if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
	}

	function autoResize(e) {
		const el = e.target;
		el.style.height = 'auto';
		const lineH = parseFloat(getComputedStyle(el).lineHeight) || 20;
		const maxH = lineH * 4 + 20; // 4 lines + padding
		el.style.height = Math.min(el.scrollHeight, maxH) + 'px';
		el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden';
	}

	function formatTime(iso) {
		const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
		return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	function formatDate(iso) {
		const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
		const today = new Date();
		if (d.toDateString() === today.toDateString()) return 'Today';
		const yesterday = new Date(today);
		yesterday.setDate(yesterday.getDate() - 1);
		if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
		return d.toLocaleDateString();
	}

	function shouldShowDate(i) {
		if (i === 0) return true;
		const curr = new Date(messages[i].created_at).toDateString();
		const prev = new Date(messages[i - 1].created_at).toDateString();
		return curr !== prev;
	}

	onMount(() => { loadHistory(); connect(); });
	onDestroy(() => { if (ws) ws.close(); });
</script>

<svelte:head><title>Chat</title></svelte:head>

<div class="chat-container">
	<div class="chat-messages" bind:this={chatEl} onscroll={handleScroll}>
		{#if loadingOlder}<div class="loading">Loading...</div>{/if}
		{#each messages as msg, i}
			{#if shouldShowDate(i)}
				<div class="date-sep"><span>{formatDate(msg.created_at)}</span></div>
			{/if}
			<div class="msg" class:human={msg.role === 'human'} class:assistant={msg.role === 'assistant'}>
				<div class="bubble">
					<span class="text">{msg.content}</span><span class="time">{formatTime(msg.created_at)}</span>
				</div>
			</div>
		{:else}
			<div class="empty">No messages yet. Say something!</div>
		{/each}
	</div>

	<div class="chat-input">
		<textarea
			bind:this={textareaEl}
			bind:value={input}
			onkeydown={handleKeydown}
			oninput={autoResize}
			placeholder="Type a message..."
			rows="1"
			disabled={sending}
		></textarea>
		<button onclick={send} disabled={sending || !input.trim()}>Send</button>
	</div>
</div>

<style>
	.chat-container { display: flex; flex-direction: column; height: calc(100vh - 8em); max-height: 800px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
	.chat-messages { flex: 1; overflow-y: auto; padding: 1em; display: flex; flex-direction: column; gap: 0.5em; }
	.loading, .date-sep { text-align: center; font-size: 0.75em; color: var(--text-muted); }
	.loading { padding: 0.5em; }
	.date-sep { margin: 0.75em 0 0.25em; }
	.date-sep span { background: var(--code-bg); padding: 0.2em 0.75em; border-radius: 10px; }
	.msg { display: flex; }
	.msg.human { justify-content: flex-end; }
	.msg.assistant { justify-content: flex-start; }
	.bubble { max-width: 75%; padding: 0.4em 0.7em; border-radius: 16px; line-height: 1.4; word-wrap: break-word; white-space: pre-wrap; }
	.msg.human .bubble { background: var(--link); color: white; border-bottom-right-radius: 4px; }
	.msg.assistant .bubble { background: var(--code-bg); color: var(--text); border-bottom-left-radius: 4px; }
	.text { font-size: 0.9em; }
	.time { display: inline; float: right; font-size: 0.65em; opacity: 0.5; margin-left: 0.75em; margin-top: 0.35em; }
	.empty { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--text-muted); font-style: italic; }
	.chat-input { display: flex; gap: 0.5em; padding: 0.75em; border-top: 1px solid var(--border); background: var(--bg); }
	.chat-input textarea { flex: 1; padding: 0.6em 0.8em; border: 1px solid var(--border); border-radius: 8px; font-family: inherit; font-size: 0.95em; resize: none; box-sizing: border-box; background: var(--bg-surface); color: var(--text); min-height: 2.4em; max-height: none; overflow-y: hidden; }
	.chat-input textarea:focus { outline: none; border-color: var(--link); }
	.chat-input button { padding: 0.6em 1.2em; background: var(--link); color: white; border: none; border-radius: 8px; font-weight: 500; cursor: pointer; align-self: flex-end; }
	.chat-input button:hover:not(:disabled) { opacity: 0.9; }
	.chat-input button:disabled { opacity: 0.5; cursor: not-allowed; }
	@media (max-width: 600px) {
		.chat-container { height: calc(100vh - 6em); max-height: none; border-radius: 0; border-left: none; border-right: none; }
		.bubble { max-width: 85%; }
	}
</style>
