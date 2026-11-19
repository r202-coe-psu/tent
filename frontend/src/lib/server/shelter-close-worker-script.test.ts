import { describe, expect, it, vi } from 'vitest';
import {
	DEFAULTS,
	parseConfig,
	pollOnce,
	runLoop,
	runStep,
	validateOrdering
} from '../../../server/shelter-close-worker.mjs';

const ENV = { SHELTER_CLOSE_WORKER_TOKEN: 'tok' };
const cfg = (over: Record<string, string> = {}) => parseConfig({ ...ENV, ...over });
const silent = { info: vi.fn(), error: vi.fn() };

describe('parseConfig (FR-15, FR-16)', () => {
	it('requires the token', () => {
		expect(() => parseConfig({})).toThrow('SHELTER_CLOSE_WORKER_TOKEN is required');
		expect(() => parseConfig({ SHELTER_CLOSE_WORKER_TOKEN: '' })).toThrow(/TOKEN/);
	});

	it('uses the documented defaults', () => {
		const c = cfg();
		expect(c).toMatchObject({
			token: 'tok',
			baseUrl: 'http://host.docker.internal:5173',
			endpoint: 'http://host.docker.internal:5173/api/internal/shelter-close/worker/next',
			pollMs: 30_000,
			timeoutMs: 30_000,
			chunkBudgetMs: 20_000,
			leaseMs: 60_000,
			staleMs: 600_000
		});
		expect(DEFAULTS).toMatchObject({ pollMs: 30_000, timeoutMs: 30_000, leaseMs: 60_000 });
		expect(c.workerId).toMatch(/^shelter-close-worker-/);
	});

	it('reads overrides, trims the trailing slash and honours SHELTER_CLOSE_WORKER_ID', () => {
		const c = cfg({
			SHELTER_CLOSE_WORKER_URL: 'http://app:5173/',
			SHELTER_CLOSE_WORKER_ID: 'close-1',
			SHELTER_CLOSE_WORKER_POLL_MS: '500',
			SHELTER_CLOSE_CHUNK_BUDGET_MS: '10',
			SHELTER_CLOSE_WORKER_TIMEOUT_MS: '20',
			SHELTER_CLOSE_LEASE_MS: '30',
			SHELTER_CLOSE_STALE_MS: '40'
		});
		expect(c).toMatchObject({
			endpoint: 'http://app:5173/api/internal/shelter-close/worker/next',
			workerId: 'close-1',
			pollMs: 500,
			chunkBudgetMs: 10,
			timeoutMs: 20,
			leaseMs: 30,
			staleMs: 40
		});
	});

	it.each([
		'SHELTER_CLOSE_WORKER_POLL_MS',
		'SHELTER_CLOSE_WORKER_TIMEOUT_MS',
		'SHELTER_CLOSE_CHUNK_BUDGET_MS',
		'SHELTER_CLOSE_LEASE_MS',
		'SHELTER_CLOSE_STALE_MS'
	])('names %s when it is not a positive number', (name) => {
		for (const bad of ['abc', '0', '-1']) {
			expect(() => cfg({ [name]: bad })).toThrow(new RegExp(`${name} must be a positive number`));
		}
	});
});

describe('validateOrdering — CHUNK_BUDGET_MS < TIMEOUT_MS < LEASE_MS < STALE_MS (FR-16, AC-10)', () => {
	const ok = { chunkBudgetMs: 1, timeoutMs: 2, leaseMs: 3, staleMs: 4 };

	it('accepts a strictly increasing chain (and the defaults)', () => {
		expect(() => validateOrdering(ok)).not.toThrow();
		expect(() => cfg()).not.toThrow();
	});

	it.each([
		[
			{ chunkBudgetMs: 2 },
			'SHELTER_CLOSE_CHUNK_BUDGET_MS (2)',
			'SHELTER_CLOSE_WORKER_TIMEOUT_MS (2)'
		],
		[{ timeoutMs: 3 }, 'SHELTER_CLOSE_WORKER_TIMEOUT_MS (3)', 'SHELTER_CLOSE_LEASE_MS (3)'],
		[{ leaseMs: 4 }, 'SHELTER_CLOSE_LEASE_MS (4)', 'SHELTER_CLOSE_STALE_MS (4)'],
		[{ staleMs: 3 }, 'SHELTER_CLOSE_LEASE_MS (3)', 'SHELTER_CLOSE_STALE_MS (3)'],
		[
			{ chunkBudgetMs: 9 },
			'SHELTER_CLOSE_CHUNK_BUDGET_MS (9)',
			'SHELTER_CLOSE_WORKER_TIMEOUT_MS (2)'
		]
	])('rejects %j naming both offending variables', (over, a, b) => {
		let message = '';
		try {
			validateOrdering({ ...ok, ...over });
		} catch (e) {
			message = (e as Error).message;
		}
		expect(message).toContain(a);
		expect(message).toContain(b);
		expect(message).toContain('CHUNK_BUDGET_MS < WORKER_TIMEOUT_MS < LEASE_MS < STALE_MS');
	});

	it('makes parseConfig fail on a misordered env (worker exits with a clear message)', () => {
		expect(() =>
			cfg({
				SHELTER_CLOSE_CHUNK_BUDGET_MS: '100',
				SHELTER_CLOSE_LEASE_MS: '1000',
				SHELTER_CLOSE_WORKER_TIMEOUT_MS: '5000'
			})
		).toThrow(
			/SHELTER_CLOSE_WORKER_TIMEOUT_MS \(5000\) must be less than SHELTER_CLOSE_LEASE_MS \(1000\)/
		);
	});
});

const res = (status: number, body: unknown = {}, text = '') =>
	({
		status,
		ok: status >= 200 && status < 300,
		json: async () => {
			if (body === 'bad') throw new Error('not json');
			return body;
		},
		text: async () => text
	}) as unknown as Response;

describe('pollOnce', () => {
	it('POSTs with the bearer token + worker id and no body', async () => {
		const fetch = vi.fn(async () => res(204));
		await pollOnce(cfg({ SHELTER_CLOSE_WORKER_ID: 'w1' }), { fetch, log: silent });
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('http://host.docker.internal:5173/api/internal/shelter-close/worker/next');
		expect(init.method).toBe('POST');
		expect(init.headers).toEqual({
			Authorization: 'Bearer tok',
			'x-shelter-close-worker-id': 'w1'
		});
		expect(init.body).toBeUndefined();
	});

	it('returns false on 204 and true on 200 (logging the job)', async () => {
		const log = { info: vi.fn() };
		expect(await pollOnce(cfg(), { fetch: async () => res(204), log })).toBe(false);
		expect(log.info).not.toHaveBeenCalled();
		expect(
			await pollOnce(cfg(), {
				fetch: async () => res(200, { job_id: 'J1', status: 'running' }),
				log
			})
		).toBe(true);
		expect(log.info).toHaveBeenCalledWith(expect.stringContaining('job=J1 status=running'));
	});

	it('tolerates an unreadable 200 body', async () => {
		expect(await pollOnce(cfg(), { fetch: async () => res(200, 'bad'), log: silent })).toBe(true);
	});

	it('throws with status and a body excerpt on 401 / 500', async () => {
		await expect(
			pollOnce(cfg(), { fetch: async () => res(401, {}, 'Invalid token'), log: silent })
		).rejects.toThrow('worker endpoint 401: Invalid token');
		await expect(
			pollOnce(cfg(), { fetch: async () => res(500, {}, 'x'.repeat(900)), log: silent })
		).rejects.toThrow(/worker endpoint 500: x{500}$/);
	});

	it('aborts the request after timeoutMs and always clears the timer', async () => {
		let fire: () => void = () => {};
		const clear = vi.fn();
		let signal: AbortSignal | undefined;
		const fetch = vi.fn(
			(_url: string, init: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					signal = init.signal as AbortSignal;
					signal.addEventListener('abort', () => reject(new Error('aborted')));
				})
		);
		const setT = vi.fn((fn: () => void, ms: number) => {
			fire = fn;
			expect(ms).toBe(30_000);
			return 1 as unknown as ReturnType<typeof setTimeout>;
		});
		const onController = vi.fn();
		const p = pollOnce(cfg(), {
			fetch: fetch as unknown as typeof globalThis.fetch,
			setTimeout: setT as unknown as typeof setTimeout,
			clearTimeout: clear,
			onController,
			log: silent
		});
		await Promise.resolve();
		fire();
		await expect(p).rejects.toThrow('aborted');
		expect(signal?.aborted).toBe(true);
		expect(clear).toHaveBeenCalledTimes(1);
		expect(onController.mock.calls[0][0]).toBeInstanceOf(AbortController);
		expect(onController).toHaveBeenLastCalledWith(null);
	});
});

describe('runStep / runLoop', () => {
	const mk = (...responses: (Response | Error)[]) => {
		const queue = [...responses];
		return vi.fn(async () => {
			const next = queue.shift() ?? res(204);
			if (next instanceof Error) throw next;
			return next;
		});
	};

	it('sleeps pollMs after a 204 but not after a processed chunk', async () => {
		const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
		const c = cfg({ SHELTER_CLOSE_WORKER_POLL_MS: '777' });
		await runStep(
			c,
			{ stopping: () => false, errorBackoffMs: 1000 },
			{ fetch: mk(res(204)), sleep, log: silent }
		);
		expect(sleep).toHaveBeenCalledWith(777);
		sleep.mockClear();
		const out = await runStep(
			c,
			{ stopping: () => false, errorBackoffMs: 1000 },
			{ fetch: mk(res(200)), sleep, log: silent }
		);
		expect(out).toEqual({ worked: true, errorBackoffMs: 1000 });
		expect(sleep).not.toHaveBeenCalled();
	});

	it('does not sleep after a 204 once stopping', async () => {
		const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
		await runStep(
			cfg(),
			{ stopping: () => true, errorBackoffMs: 1000 },
			{ fetch: mk(res(204)), sleep, log: silent }
		);
		expect(sleep).not.toHaveBeenCalled();
	});

	it('backs off exponentially on errors, capped at 5 s', async () => {
		const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
		const deps = { fetch: mk(new Error('down')), sleep, log: silent };
		const a = await runStep(cfg(), { stopping: () => false, errorBackoffMs: 1000 }, deps);
		expect(sleep).toHaveBeenLastCalledWith(1000);
		expect(a).toEqual({ worked: false, errorBackoffMs: 2000 });
		const b = await runStep(
			cfg(),
			{ stopping: () => false, errorBackoffMs: 4000 },
			{ ...deps, fetch: mk(new Error('x')) }
		);
		expect(b.errorBackoffMs).toBe(5000);
		expect(silent.error).toHaveBeenCalled();
	});

	it('runLoop polls until stopping, drains work back-to-back and survives errors', async () => {
		const fetch = mk(res(200), res(200), new Error('blip'), res(204));
		const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
		let calls = 0;
		await runLoop(cfg(), { fetch, sleep, log: silent }, () => {
			calls += 1;
			return fetch.mock.calls.length >= 4;
		});
		expect(fetch).toHaveBeenCalledTimes(4);
		expect(calls).toBeGreaterThan(0);
		expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000]); // one backoff; the final 204 does not sleep once stopping
	});
});
