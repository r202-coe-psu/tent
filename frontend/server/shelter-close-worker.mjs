// Shelter close worker (CR-243 FR-15, FR-16). Polls the internal route; 1 call = 1 chunk.
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const LOG = '[shelter-close-worker]';

export const DEFAULTS = Object.freeze({
	url: 'http://host.docker.internal:5173',
	pollMs: 30_000,
	timeoutMs: 30_000,
	chunkBudgetMs: 20_000,
	leaseMs: 60_000,
	staleMs: 600_000
});

/** @type {Array<['pollMs' | 'timeoutMs' | 'chunkBudgetMs' | 'leaseMs' | 'staleMs', string]>} */
const NUMERIC_VARS = [
	['pollMs', 'SHELTER_CLOSE_WORKER_POLL_MS'],
	['timeoutMs', 'SHELTER_CLOSE_WORKER_TIMEOUT_MS'],
	['chunkBudgetMs', 'SHELTER_CLOSE_CHUNK_BUDGET_MS'],
	['leaseMs', 'SHELTER_CLOSE_LEASE_MS'],
	['staleMs', 'SHELTER_CLOSE_STALE_MS']
];

/**
 * @typedef {{ token: string, baseUrl: string, workerId: string, pollMs: number, timeoutMs: number,
 *   chunkBudgetMs: number, leaseMs: number, staleMs: number, endpoint: string }} WorkerConfig
 */

/**
 * Parse + validate config from an env map. Throws Error naming offending variables.
 * @param {Record<string, string | undefined>} env
 */
export function parseConfig(env = process.env) {
	const token = env.SHELTER_CLOSE_WORKER_TOKEN;
	if (!token) throw new Error('SHELTER_CLOSE_WORKER_TOKEN is required');
	const cfg = /** @type {WorkerConfig} */ ({
		token,
		baseUrl: (env.SHELTER_CLOSE_WORKER_URL || DEFAULTS.url).replace(/\/$/, ''),
		workerId: env.SHELTER_CLOSE_WORKER_ID || `shelter-close-worker-${process.pid}-${randomUUID()}`
	});
	for (const [key, name] of NUMERIC_VARS) {
		const raw = env[name];
		if (raw === undefined || raw === '') {
			cfg[key] = DEFAULTS[key];
			continue;
		}
		const n = Number(raw);
		if (!Number.isFinite(n) || n <= 0) {
			throw new Error(`${name} must be a positive number (got "${raw}")`);
		}
		cfg[key] = n;
	}
	cfg.endpoint = `${cfg.baseUrl}/api/internal/shelter-close/worker/next`;
	validateOrdering(cfg);
	return cfg;
}

/**
 * FR-16: CHUNK_BUDGET_MS < TIMEOUT_MS < LEASE_MS < STALE_MS.
 * @param {Pick<WorkerConfig, 'chunkBudgetMs' | 'timeoutMs' | 'leaseMs' | 'staleMs'>} cfg
 */
export function validateOrdering(cfg) {
	const chain = [
		['SHELTER_CLOSE_CHUNK_BUDGET_MS', cfg.chunkBudgetMs],
		['SHELTER_CLOSE_WORKER_TIMEOUT_MS', cfg.timeoutMs],
		['SHELTER_CLOSE_LEASE_MS', cfg.leaseMs],
		['SHELTER_CLOSE_STALE_MS', cfg.staleMs]
	];
	for (let i = 0; i < chain.length - 1; i++) {
		const [a, av] = chain[i];
		const [b, bv] = chain[i + 1];
		if (!(av < bv)) {
			throw new Error(
				`invalid timing config: ${a} (${av}) must be less than ${b} (${bv}); ` +
					`required order CHUNK_BUDGET_MS < WORKER_TIMEOUT_MS < LEASE_MS < STALE_MS`
			);
		}
	}
}

/**
 * One poll. Returns true when work was processed (200), false on 204. Throws otherwise.
 * @param {WorkerConfig} cfg
 * @param {{ fetch?: typeof fetch, setTimeout?: typeof setTimeout, clearTimeout?: typeof clearTimeout,
 *   onController?: (c: AbortController | null) => void, log?: Pick<Console,'info'> }} [deps]
 */
export async function pollOnce(cfg, deps = {}) {
	const doFetch = deps.fetch ?? fetch;
	const setT = deps.setTimeout ?? setTimeout;
	const clearT = deps.clearTimeout ?? clearTimeout;
	const log = deps.log ?? console;
	const controller = new AbortController();
	deps.onController?.(controller);
	const timer = setT(() => controller.abort(), cfg.timeoutMs);
	try {
		const response = await doFetch(cfg.endpoint, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${cfg.token}`,
				'x-shelter-close-worker-id': cfg.workerId
			},
			signal: controller.signal
		});
		if (response.status === 204) return false;
		if (!response.ok) {
			const body = await response.text();
			throw new Error(`worker endpoint ${response.status}: ${body.slice(0, 500)}`);
		}
		/** @type {Record<string, any>} */
		let result = {};
		try {
			result = await response.json();
		} catch {
			// body is informational only
		}
		log.info(
			`${LOG} processed chunk job=${result.jobId ?? result.job_id ?? 'unknown'}` +
				(result.status ? ` status=${result.status}` : '')
		);
		return true;
	} finally {
		clearT(timer);
		deps.onController?.(null);
	}
}

/**
 * Loop step: poll once and sleep as needed. 200 -> poll again immediately; 204 -> sleep pollMs;
 * error -> exponential backoff (1s..5s). Returns the next backoff value.
 * @param {WorkerConfig} cfg
 * @param {{ stopping: () => boolean, errorBackoffMs: number }} state
 * @param {any} [deps]
 * @returns {Promise<{ worked: boolean, errorBackoffMs: number }>}
 */
export async function runStep(cfg, state, deps = {}) {
	const sleep = deps.sleep ?? ((/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms)));
	const log = deps.log ?? console;
	try {
		const worked = await pollOnce(cfg, deps);
		if (!worked && !state.stopping()) await sleep(cfg.pollMs);
		return { worked, errorBackoffMs: 1000 };
	} catch (error) {
		log.error?.(`${LOG} poll failed`, error);
		await sleep(state.errorBackoffMs);
		return { worked: false, errorBackoffMs: Math.min(state.errorBackoffMs * 2, 5000) };
	}
}

/**
 * Run until `stopping()` is true.
 * @param {WorkerConfig} cfg
 * @param {any} [deps]
 * @param {() => boolean} [stopping]
 */
export async function runLoop(cfg, deps = {}, stopping = () => false) {
	let errorBackoffMs = 1000;
	while (!stopping()) {
		const res = await runStep(cfg, { stopping, errorBackoffMs }, deps);
		errorBackoffMs = res.errorBackoffMs;
	}
}

async function main() {
	/** @type {WorkerConfig} */
	let cfg;
	try {
		cfg = parseConfig(process.env);
	} catch (error) {
		console.error(`${LOG} ${error instanceof Error ? error.message : error}`);
		process.exit(1);
	}
	let stopping = false;
	/** @type {AbortController | null} */
	let active = null;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let shutdownTimer = null;
	for (const signal of ['SIGINT', 'SIGTERM']) {
		process.on(signal, () => {
			stopping = true;
			console.info(`${LOG} received ${signal}; stopping after current request`);
			if (active && !shutdownTimer) {
				shutdownTimer = setTimeout(() => {
					console.warn(`${LOG} shutdown grace period expired; aborting request`);
					active?.abort();
				}, 30_000);
			}
		});
	}
	console.info(`${LOG} polling ${cfg.endpoint} as ${cfg.workerId}`);
	await runLoop(
		cfg,
		{
			onController: (/** @type {AbortController | null} */ c) => {
				active = c;
				if (!c && shutdownTimer) {
					clearTimeout(shutdownTimer);
					shutdownTimer = null;
				}
			}
		},
		() => stopping
	);
	console.info(`${LOG} stopped`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
