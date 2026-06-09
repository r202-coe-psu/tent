import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');

	// Strip embedded credentials — proxy target must be scheme://host:port only.
	const couchTarget = (env.PUBLIC_COUCHDB_URL ?? 'http://localhost:5984').replace(
		/^(https?:\/\/)[^@/]+@/,
		'$1'
	);

	return {
		plugins: [tailwindcss(), sveltekit(), devtoolsJson()],
		server: {
			proxy: {
				'/couch': {
					target: couchTarget,
					changeOrigin: true,
					rewrite: (path) => path.replace(/^\/couch/, '')
				}
			}
		},
		optimizeDeps: {
			include: ['pouchdb-browser']
		},
		test: {
			globals: true,
			environment: 'node',
			include: ['src/**/*.{test,spec}.{ts,js}']
		}
	};
});
