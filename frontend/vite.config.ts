import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { configDefaults, defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import { globSync, readFileSync } from 'node:fs';

function couchInit(user: string, password: string, couchUrl: string) {
	return {
		name: 'couch-init',
		configureServer() {
			const base = couchUrl;
			const auth = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
			const dbs = ['_users', '_replicator', '_global_changes'];
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

// --- Vitest project split (see CONTRIBUTING.md §6) -------------------------------------------
// `pure` runs with `isolate: false` (one shared module graph per worker => far less import/transform
// work). That is only safe for tests with no module-level or global state, so membership is
// rule-based: pure-by-convention directories, minus any file that mocks modules / stubs env or
// globals / switches environment (those go to `isolated` automatically). Every other test file
// stays in `isolated`, so each file runs in exactly one project.
const TEST_INCLUDE = ['src/**/*.{test,spec}.{ts,js}'];
const PURE_GLOBS = [
	'src/lib/**/domain/**/*.test.ts',
	'src/lib/db/**/*.test.ts',
	'src/lib/auth/**/*.test.ts'
];
const NEEDS_ISOLATION =
	/\bvi\.(mock|doMock|hoisted|unmock|importActual|resetModules|stubEnv|stubGlobal|useFakeTimers)\b|@vitest-environment|process\.env|globalThis/;

const pureTestFiles = globSync(PURE_GLOBS)
	.filter((file) => !NEEDS_ISOLATION.test(readFileSync(file, 'utf8')))
	.map((file) => file.replaceAll('\\', '/'))
	.sort();

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');

	// Strip embedded credentials — proxy target must be scheme://host:port only.
	const couchTarget = (env.PUBLIC_COUCHDB_URL ?? 'http://localhost:5984').replace(
		/^(https?:\/\/)[^@/]+@/,
		'$1'
	);

	return {
		plugins: [
			tailwindcss(),
			sveltekit(),
			devtoolsJson(),
			// Dev-only side effect (PUTs to CouchDB) — never run it inside unit tests.
			...(process.env.VITEST
				? []
				: [couchInit(env.COUCHDB_USER ?? 'admin', env.COUCHDB_PASSWORD ?? 'password', couchTarget)])
		],
		ssr: {
			noExternal: ['decimal.js', 'jsonwebtoken', 'openapi-fetch']
		},
		server: {
			allowedHosts: ['host.docker.internal'],
			proxy: {
				'/couch': {
					target: couchTarget,
					changeOrigin: true,
					rewrite: (path) => path.replace(/^\/couch/, '')
				}
				// Public plane: browser → SvelteKit BFF `/api/public/v1/*` → FastAPI
				// with EXTERNAL_API_SECRET (CR-063). No browser `/public-api` gateway.
			}
		},
		test: {
			globals: true,
			environment: 'node',
			setupFiles: ['./src/lib/testing/vitest-setup.ts'],
			// Persistent transform cache: node_modules/.experimental-vitest-cache (delete if stale).
			experimental: { fsModuleCache: true },
			projects: [
				{
					extends: true,
					test: { name: 'pure', include: pureTestFiles, isolate: false }
				},
				{
					extends: true,
					test: {
						name: 'isolated',
						include: TEST_INCLUDE,
						exclude: [...configDefaults.exclude, ...pureTestFiles]
					}
				}
			]
		}
	};
});
