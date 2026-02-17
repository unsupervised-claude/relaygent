import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
export default {
	kit: {
		adapter: adapter({ out: 'build' }),
		csrf: {
			// Hub is internal-only (local network), not exposed to public internet.
			// Non-localhost origins don't match the server's origin, triggering
			// SvelteKit's built-in CSRF protection. Safe to disable for internal tool.
			checkOrigin: false,
		},
	}
};
