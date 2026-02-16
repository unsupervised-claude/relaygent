<script>
	import ScreenStream from '$lib/components/ScreenStream.svelte';
</script>

<svelte:head><title>Screen | Relaygent</title></svelte:head>

<h1>Screen</h1>
<p class="subtitle">Live view of what the agent sees.</p>

<ScreenStream fps={8} />

<style>
	h1 { margin-top: 0; }
	.subtitle { color: var(--text-muted); margin-top: -0.5em; margin-bottom: 1em; font-size: 0.9em; }
</style>
