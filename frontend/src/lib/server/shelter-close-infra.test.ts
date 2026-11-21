/**
 * Ingress / config guard for the shelter-close-worker (CR-243 FR-34..FR-38, AC-9, AC-10): reads
 * the compose files, both .env.example files, nginx.conf and package.json from disk, the same
 * way `ingress-security.test.ts` does for the import worker.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

const WORKER_COMPOSE = [
	'docker-compose.yml',
	'docker-compose.staging.yml',
	'docker-compose.staging.no-nginx.yml',
	'docker-compose.production.yml',
	'docker-compose.production.no-nginx.yml'
];
const WITHOUT_WORKER = ['docker-compose.edge.yml', 'docker-compose.seed.yml'];
// CR-243 runtime moved into the Python `jobs-worker` (#1479); the Node script is gone.
const SERVICE = 'jobs-worker';

/** Text of one top-level compose service (2-space indented key) up to the next one. */
function service(file: string, name: string): string | null {
	const lines = read(file).split('\n');
	const start = lines.findIndex((l) => l === `  ${name}:`);
	if (start < 0) return null;
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (/^ {0,2}\S/.test(lines[i]) && !lines[i].startsWith('   ')) {
			end = i;
			break;
		}
	}
	return lines.slice(start, end).join('\n');
}

/** FR-16 ordering (mirrors worker/src/worker/jobs/shelter_close.py::validate_ordering). */
function validateOrdering(c: {
	chunkBudgetMs: number;
	timeoutMs: number;
	leaseMs: number;
	staleMs: number;
}) {
	if (!(c.chunkBudgetMs < c.timeoutMs && c.timeoutMs < c.leaseMs && c.leaseMs < c.staleMs)) {
		throw new Error('CHUNK_BUDGET_MS < WORKER_TIMEOUT_MS < LEASE_MS < STALE_MS violated');
	}
}

const envValue = (text: string, key: string) =>
	new RegExp(`^${key}=(.*)$`, 'm').exec(text)?.[1]?.trim();

const VARS = [
	'SHELTER_CLOSE_WORKER_TOKEN',
	'SHELTER_CLOSE_WORKER_URL',
	'SHELTER_CLOSE_WORKER_TIMEOUT_MS',
	'SHELTER_CLOSE_CHUNK_BUDGET_MS',
	'SHELTER_CLOSE_LEASE_MS',
	'SHELTER_CLOSE_MAX_ATTEMPTS',
	'SHELTER_CLOSE_MAX_FAILURES',
	'SHELTER_CLOSE_STALE_MS'
];

describe('compose files (FR-34, FR-35, AC-10)', () => {
	it.each(WORKER_COMPOSE)('%s has a jobs-worker service running the close job', (file) => {
		const worker = service(file, SERVICE);
		expect(worker, `${file} must define ${SERVICE}`).not.toBeNull();
		expect(worker).toContain('restart: unless-stopped');
		// FR-35: the token is mandatory — compose refuses to start without it.
		expect(worker).toContain(
			'SHELTER_CLOSE_WORKER_TOKEN: ${SHELTER_CLOSE_WORKER_TOKEN:?SHELTER_CLOSE_WORKER_TOKEN is required}'
		);
		expect(service(file, 'shelter-close-worker'), 'old node service removed').toBeNull();
		expect(service(file, 'import-worker'), 'old node service removed').toBeNull();
	});

	it.each(WORKER_COMPOSE.filter((f) => f !== 'docker-compose.yml'))(
		'%s: worker reaches the frontend over the compose network',
		(file) => {
			const worker = service(file, SERVICE)!;
			expect(worker).toContain('SHELTER_CLOSE_WORKER_URL: http://frontend:3000');
			expect(worker).toMatch(/depends_on:[\s\S]*?\n\s+frontend:\s*\n\s+condition: service_healthy/);
		}
	);

	it.each(WORKER_COMPOSE.filter((f) => f !== 'docker-compose.yml'))(
		'%s: the frontend service gets the token and the server-side knobs the route reads',
		(file) => {
			const frontend = service(file, 'frontend')!;
			for (const key of [
				'SHELTER_CLOSE_WORKER_TOKEN',
				'SHELTER_CLOSE_CHUNK_BUDGET_MS',
				'SHELTER_CLOSE_LEASE_MS',
				'SHELTER_CLOSE_MAX_ATTEMPTS',
				'SHELTER_CLOSE_MAX_FAILURES',
				'SHELTER_CLOSE_STALE_MS'
			]) {
				expect(frontend, `${file} frontend is missing ${key}`).toContain(`${key}:`);
			}
		}
	);

	it.each(WITHOUT_WORKER)('%s does not get the worker', (file) => {
		expect(service(file, SERVICE)).toBeNull();
	});
});

describe('.env.example files (FR-36)', () => {
	const rootEnv = read('.env.example');
	const frontendEnv = read('frontend/.env.example');

	it.each(VARS)('both files define %s', (key) => {
		expect(envValue(rootEnv, key), `root .env.example ${key}`).toBeTruthy();
		expect(envValue(frontendEnv, key), `frontend/.env.example ${key}`).toBeTruthy();
	});

	it('uses the same token placeholder in both files, like SHELTER_IMPORT_WORKER_TOKEN', () => {
		expect(envValue(rootEnv, 'SHELTER_CLOSE_WORKER_TOKEN')).toBe(
			envValue(frontendEnv, 'SHELTER_CLOSE_WORKER_TOKEN')
		);
		expect(envValue(rootEnv, 'SHELTER_IMPORT_WORKER_TOKEN')).toBe(
			envValue(frontendEnv, 'SHELTER_IMPORT_WORKER_TOKEN')
		);
	});

	it('uses the same value in both files for every tunable and the documented defaults', () => {
		const defaults: Record<string, string> = {
			SHELTER_CLOSE_WORKER_URL: 'http://host.docker.internal:5173',
			SHELTER_CLOSE_WORKER_TIMEOUT_MS: '30000',
			SHELTER_CLOSE_CHUNK_BUDGET_MS: '20000',
			SHELTER_CLOSE_LEASE_MS: '60000',
			SHELTER_CLOSE_MAX_ATTEMPTS: '5',
			SHELTER_CLOSE_MAX_FAILURES: '50',
			SHELTER_CLOSE_STALE_MS: '600000'
		};
		for (const [key, value] of Object.entries(defaults)) {
			expect(envValue(rootEnv, key)).toBe(value);
			expect(envValue(frontendEnv, key)).toBe(value);
		}
	});

	it('the example timings satisfy the worker ordering check', () => {
		const n = (k: string) => Number(envValue(rootEnv, k));
		expect(() =>
			validateOrdering({
				chunkBudgetMs: n('SHELTER_CLOSE_CHUNK_BUDGET_MS'),
				timeoutMs: n('SHELTER_CLOSE_WORKER_TIMEOUT_MS'),
				leaseMs: n('SHELTER_CLOSE_LEASE_MS'),
				staleMs: n('SHELTER_CLOSE_STALE_MS')
			})
		).not.toThrow();
	});
});

describe('nginx + package.json (FR-37, FR-38)', () => {
	it('nginx denies the internal worker path on the public listener, ahead of the catch-all', () => {
		const nginx = read('nginx/nginx.conf');
		expect(nginx).toMatch(
			/location\s+\^~\s+\/api\/internal\/shelter-close\/worker\/\s*\{[\s\S]*?return\s+404;/
		);
		expect(nginx.indexOf('/api/internal/shelter-close/worker/')).toBeLessThan(
			nginx.indexOf('location / {')
		);
	});

	it('no longer has the node worker scripts', () => {
		const pkg = JSON.parse(read('frontend/package.json')) as { scripts: Record<string, string> };
		expect(pkg.scripts['shelter-close-worker']).toBeUndefined();
		expect(pkg.scripts['import-worker']).toBeUndefined();
	});
});
