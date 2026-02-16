<script>
	import { onMount, onDestroy } from 'svelte';

	let { fps = 10 } = $props();
	let imgEl = $state(null);
	let online = $state(false);
	let everLoaded = $state(false);
	let interval = null;
	let pending = false;

	function refresh() {
		if (!imgEl || pending) return;
		pending = true;
		const img = new Image();
		img.onload = () => {
			imgEl.src = img.src;
			online = true;
			everLoaded = true;
			pending = false;
		};
		img.onerror = () => {
			online = false;
			pending = false;
		};
		img.src = `/api/screen?t=${Date.now()}`;
	}

	onMount(() => {
		refresh();
		interval = setInterval(refresh, 1000 / fps);
	});
	onDestroy(() => { if (interval) clearInterval(interval); });
</script>

<div class="stream">
	<div class="stream-header">
		<span class="dot" class:ok={online}></span>
		<span class="stream-label">Screen</span>
	</div>
	<div class="frame">
		{#if !everLoaded}<div class="placeholder">Connecting...</div>{/if}
		<img bind:this={imgEl} alt="Screen" style="display:{everLoaded ? 'block' : 'none'}" />
	</div>
</div>

<style>
	.stream { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; }
	.stream-header { display: flex; align-items: center; gap: 0.5em; padding: 0.35em 0.6em; border-bottom: 1px solid var(--border); }
	.stream-label { font-weight: 600; font-size: 0.8em; }
	.dot { width: 6px; height: 6px; border-radius: 50%; background: #ef4444; flex-shrink: 0; }
	.dot.ok { background: #22c55e; }
	.frame { position: relative; background: #111; overflow: hidden; }
	.frame img { width: 100%; height: auto; display: block; }
	.placeholder { padding: 4em; text-align: center; color: #888; font-size: 0.85em; }
</style>
