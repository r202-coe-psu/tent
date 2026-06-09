import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),
	kit: {
		// SPA fallback: the admin/register API routes under /api/* run only on the
		// SvelteKit dev server (they hold the admin secret). The static production
		// build emits a fallback shell and omits those dynamic routes.
		adapter: adapter({ fallback: '200.html' })
	}
};

export default config;
