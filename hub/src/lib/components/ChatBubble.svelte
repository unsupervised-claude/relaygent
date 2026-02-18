<script>
	import { onMount, onDestroy, tick } from 'svelte';
	import { browser } from '$app/environment';
	import './ChatBubble.css';

	let open = $state(false);
	let messages = $state([]);
	let input = $state('');
	let sending = $state(false);
	let tabUnread = $state(0);
	let hasMore = $state(true);
	let loadingOlder = $state(false);
	let ws = null;
	let chatEl = $state(null);
	let textareaEl = $state(null);
	let autoScroll = true;
	let audioCtx = null;
	let defaultTitle = '';

	function initAudio() {
		if (audioCtx) return;
		try {
			audioCtx = new (window.AudioContext || window.webkitAudioContext)();
			if (audioCtx.state === 'suspended') audioCtx.resume();
			document.removeEventListener('click', initAudio);
			document.removeEventListener('keydown', initAudio);
		} catch {}
	}

	function playChime() {
		try {
			initAudio();
			if (!audioCtx || audioCtx.state === 'suspended') return;
			const now = audioCtx.currentTime;
			[659.25, 783.99].forEach((freq, i) => {
				const osc = audioCtx.createOscillator();
				const gain = audioCtx.createGain();
				osc.type = 'sine';
				osc.frequency.value = freq;
				gain.gain.setValueAtTime(0.15, now + i * 0.12);
				gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.4);
				osc.connect(gain);
				gain.connect(audioCtx.destination);
				osc.start(now + i * 0.12);
				osc.stop(now + i * 0.12 + 0.4);
			});
		} catch {}
	}

	function updateTabTitle() {
		if (!browser) return;
		document.title = tabUnread > 0 ? `(${tabUnread}) ${defaultTitle}` : defaultTitle;
	}

	function clearUnread() {
		tabUnread = 0;
		updateTabTitle();
	}

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
				const wasHidden = !open || !autoScroll;
				if (!open) open = true;
				if (wasHidden) {
					tabUnread++;
					updateTabTitle();
					playChime();
				}
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
		clearUnread();
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

	function toggle() {
		open = !open;
		if (open) { clearUnread(); tick().then(scrollBottom); }
	}

	onMount(() => {
		defaultTitle = document.title || 'Relaygent Hub';
		document.addEventListener('click', initAudio);
		document.addEventListener('keydown', initAudio);
		loadHistory();
		connect();
	});
	onDestroy(() => {
		if (ws) ws.close();
		if (browser) {
			document.removeEventListener('click', initAudio);
			document.removeEventListener('keydown', initAudio);
			document.title = defaultTitle;
		}
	});
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
		{#if tabUnread > 0 && !open}<span class="cb-badge">{tabUnread > 9 ? '9+' : tabUnread}</span>{/if}
	</button>
</div>

