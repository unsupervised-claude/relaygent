<script>
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import ChatBubble from '$lib/components/ChatBubble.svelte';

	let { children } = $props();
	let darkMode = $state(false);
	let menuOpen = $state(false);

	if (browser) {
		const stored = localStorage.getItem('darkMode');
		if (stored !== null) darkMode = stored === 'true';
		else darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
		document.body.classList.toggle('dark-mode', darkMode);
	}

	function toggleDark() {
		darkMode = !darkMode;
		if (browser) {
			localStorage.setItem('darkMode', darkMode);
			document.body.classList.toggle('dark-mode', darkMode);
		}
	}

	function closeMenu() { menuOpen = false; }
	function isActive(href) { return $page.url.pathname === href || (href !== '/' && $page.url.pathname.startsWith(href)); }
</script>

<svelte:head><link rel="icon" href="/favicon.svg" /></svelte:head>

<div class="app-wrapper" class:dark={darkMode}>
<nav>
	<a href="/" class="brand">Relaygent</a>
	<button class="hamburger" onclick={() => menuOpen = !menuOpen} aria-label="Toggle menu">
		<span class="bar" class:open={menuOpen}></span>
		<span class="bar" class:open={menuOpen}></span>
		<span class="bar" class:open={menuOpen}></span>
	</button>
	<div class="links" class:open={menuOpen}>
		<a href="/intent" class:active={isActive('/intent')} onclick={closeMenu}>Intent</a>
		<a href="/kb" class:active={isActive('/kb')} onclick={closeMenu}>KB</a>
		<a href="/stream" class:active={isActive('/stream')} onclick={closeMenu}>Screen</a>
		<a href="/notifications" class:active={isActive('/notifications')} onclick={closeMenu}>Notifications</a>
		<a href="/search" class:active={isActive('/search')} onclick={closeMenu}>Search</a>
		<button class="theme-toggle" onclick={toggleDark} aria-label="Toggle dark mode">
			{darkMode ? 'Light' : 'Dark'}
		</button>
	</div>
</nav>

<main>
	{@render children()}
</main>
<ChatBubble />
</div>

<style>
	:global(html), :global(body) {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		margin: 0; padding: 0; line-height: 1.6; background: #fafafa;
		overflow-x: hidden; -webkit-text-size-adjust: 100%;
	}
	:global(body.dark-mode) { background: #0d1117; }

	.app-wrapper {
		--bg: #fafafa; --bg-surface: #fff; --text: #1a1a1a; --text-muted: #555;
		--link: #2563eb; --border: #e5e5e5; --code-bg: #f0f0f0; --th-bg: #f5f5f5;
		background: var(--bg); color: var(--text); min-height: 100vh;
	}
	.app-wrapper.dark {
		--bg: #0d1117; --bg-surface: #161b22; --text: #e6edf3; --text-muted: #8b949e;
		--link: #58a6ff; --border: #30363d; --code-bg: #21262d; --th-bg: #21262d;
	}

	:global(a) { color: var(--link); text-decoration: none; }
	:global(a:hover) { text-decoration: underline; }
	:global(code) { background: var(--code-bg); padding: 0.15em 0.4em; border-radius: 3px; font-size: 0.9em; }
	:global(pre) { background: var(--code-bg); padding: 1em; border-radius: 6px; overflow-x: auto; }
	:global(pre code) { background: none; padding: 0; }
	:global(table) { border-collapse: collapse; width: 100%; }
	:global(th, td) { border: 1px solid var(--border); padding: 0.5em 0.75em; text-align: left; }
	:global(th) { background: var(--th-bg); }
	:global(blockquote) { border-left: 3px solid var(--border); margin-left: 0; padding-left: 1em; color: var(--text-muted); }
	:global(h1, h2, h3) { margin-top: 1.5em; margin-bottom: 0.5em; }

	nav {
		display: flex; align-items: center; justify-content: space-between;
		padding: 0.75em 1.5em; background: var(--bg-surface);
		border-bottom: 1px solid var(--border); position: relative;
	}
	.brand { font-weight: 700; font-size: 1.1em; color: var(--text); }
	.links { display: flex; gap: 1.25em; align-items: center; }
	.links a.active { color: var(--text); font-weight: 600; border-bottom: 2px solid var(--link); padding-bottom: 0.1em; text-decoration: none; }
	.hamburger { display: none; }

	.theme-toggle {
		background: none; border: 1px solid var(--border); cursor: pointer;
		font-size: 0.85em; padding: 0.25em 0.5em; border-radius: 4px; color: var(--text-muted);
	}
	.theme-toggle:hover { color: var(--text); }

	main { max-width: 900px; margin: 2em auto; padding: 0 1.5em; }

	@media (max-width: 600px) {
		nav { padding: 0.5em 1em; }
		.hamburger {
			display: flex; flex-direction: column; gap: 4px;
			background: none; border: none; cursor: pointer; padding: 0.4em; z-index: 101;
		}
		.bar {
			display: block; width: 20px; height: 2px; background: var(--text);
			border-radius: 1px; transition: transform 0.2s, opacity 0.2s;
		}
		.bar.open:nth-child(1) { transform: rotate(45deg) translate(4px, 4px); }
		.bar.open:nth-child(2) { opacity: 0; }
		.bar.open:nth-child(3) { transform: rotate(-45deg) translate(4px, -4px); }
		.links {
			display: none; flex-direction: column; gap: 0;
			position: absolute; top: 100%; left: 0; right: 0;
			background: var(--bg-surface); border-bottom: 1px solid var(--border);
			padding: 0.5em 0; z-index: 100; box-shadow: 0 4px 12px rgba(0,0,0,0.1);
		}
		.links.open { display: flex; }
		.links a {
			padding: 0.6em 1.5em; width: 100%; box-sizing: border-box;
			color: var(--text); font-size: 0.95em;
		}
		.links a:hover { background: var(--code-bg); text-decoration: none; }
		.links a.active { background: var(--code-bg); border-bottom: none; border-left: 3px solid var(--link); font-weight: 600; }
		.theme-toggle { padding: 0.6em 1.5em; text-align: left; border: none; }
		main { margin: 1em auto; padding: 0 1em; }
	}
</style>
