import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),
	kit: {
		// SPA/PWA served by a Node server. App pages stay client-rendered
		// (ssr = false, see routes/+layout.ts), while the /api/* server routes
		// (admin, register) run on the Node runtime in production — they hold the
		// admin secret and are marked prerender = false so they stay dynamic.
		adapter: adapter()
	}
};

export default config;
