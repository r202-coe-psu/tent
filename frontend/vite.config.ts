import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

function couchInit(user: string, password: string, couchUrl: string) {
	return {
		name: 'couch-init',
		configureServer() {
			const base = couchUrl;
			const auth = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
			const dbs = ['_users', '_replicator', '_global_changes', 'notes'];
			Promise.all(
				dbs.map((db) =>
					fetch(`${base}/${db}`, { method: 'PUT', headers: { Authorization: auth } })
						.then((r) => r.json())
						.then((r) => {
							if (r.ok) console.log(`[couch-init] created ${db}`);
							else if (r.error === 'file_exists') console.log(`[couch-init] exists  ${db}`);
							else console.warn(`[couch-init] ${db}:`, r);
						})
						.catch((e) => console.warn(`[couch-init] ${db} unreachable:`, e.message))
				)
			);
		}
	};
}

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');

	// Strip embedded credentials — proxy target must be scheme://host:port only.
	const couchTarget = (env.PUBLIC_COUCHDB_URL ?? 'http://localhost:5984').replace(
		/^(https?:\/\/)[^@/]+@/,
		'$1'
	);
	const fastapiTarget = env.PUBLIC_FASTAPI_PROXY || 'http://localhost:9000';

	return {
		plugins: [
			tailwindcss(),
			sveltekit(),
			devtoolsJson(),
			couchInit(env.COUCHDB_USER ?? 'admin', env.COUCHDB_PASSWORD ?? 'password', couchTarget)
		],
		ssr: {
			noExternal: ['decimal.js', 'jsonwebtoken', 'openapi-fetch', 'qrcode']
		},
		server: {
			proxy: {
				'/couch': {
					target: couchTarget,
					changeOrigin: true,
					rewrite: (path) => path.replace(/^\/couch/, '')
				},
				// Public plane → FastAPI (dev only; prod/staging use nginx /public-api/).
				// Strip gateway prefix so FastAPI still sees /public/v1/*.
				// SPA /public/* and BFF /api/* are unaffected.
				'/public-api': {
					target: fastapiTarget,
					changeOrigin: true,
					rewrite: (path) => path.replace(/^\/public-api/, '')
				}
			}
		},
		test: {
			globals: true,
			environment: 'node',
			include: ['src/**/*.{test,spec}.{ts,js}']
		}
	};
});
