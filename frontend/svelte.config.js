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
		adapter: adapter(),
		// Content-Security-Policy, sent as a response header. It locks down where scripts may
		// come from — the XSS vector that would let an injected script read the remembered
		// volunteer token in localStorage (#625) — and leaves fetch / image / style origins
		// open: the edge CouchDB fallback, map tiles and photos come from hosts that vary
		// per deployment, and an injected script cannot run here to use them anyway.
		// SvelteKit adds a per-response nonce for its own bootstrap script (`mode: 'auto'`).
		csp: {
			mode: 'auto',
			directives: {
				// reCAPTCHA Enterprise (donor form) loads its script from these two paths.
				'script-src': [
					'self',
					'https://www.google.com/recaptcha/',
					'https://www.gstatic.com/recaptcha/'
				],
				// maplibre-gl runs its tile worker from a blob: URL.
				'worker-src': ['self', 'blob:'],
				'object-src': ['none'],
				'base-uri': ['self'],
				// No other site may frame the app (clickjacking).
				'frame-ancestors': ['none']
			}
		}
	}
};

export default config;
