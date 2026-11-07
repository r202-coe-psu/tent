import { describe, expect, it, vi } from 'vitest';
import { runHousekeepingTick } from '../../../../server/print-housekeeping-tick.mjs';

const URL = 'http://frontend:3000/api/internal/printers/housekeeping';
const TOKEN = 'hk-secret-token';

function deps(overrides: Record<string, unknown> = {}) {
	return {
		url: URL,
		token: TOKEN,
		timeoutMs: 25_000,
		okFile: '/tmp/test-print-housekeeping.ok',
		fetch: vi.fn(async () => new Response(JSON.stringify({ swept: 0 }), { status: 200 })),
		writeFile: vi.fn(),
		now: () => 1_700_000_000_000,
		log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		...overrides
	};
}

describe('runHousekeepingTick', () => {
	it('posts to the housekeeping endpoint with the bearer token and records the epoch on 2xx', async () => {
		const d = deps();

		const result = await runHousekeepingTick(d);

		expect(result).toEqual({ ok: true, status: 200 });
		expect(d.fetch).toHaveBeenCalledTimes(1);
		const [calledUrl, init] = d.fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(calledUrl).toBe(URL);
		expect(init.method).toBe('POST');
		expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
		expect(d.writeFile).toHaveBeenCalledWith('/tmp/test-print-housekeeping.ok', '1700000000000');
	});

	it('logs a non-2xx status without the token and leaves the healthcheck file alone', async () => {
		const d = deps({
			fetch: vi.fn(async () => new Response(`denied ${TOKEN}`, { status: 401 }))
		});

		const result = await runHousekeepingTick(d);

		expect(result).toEqual({ ok: false, status: 401 });
		expect(d.writeFile).not.toHaveBeenCalled();
		const logged = JSON.stringify(d.log.error.mock.calls);
		expect(logged).toContain('401');
		expect(logged).not.toContain(TOKEN);
	});

	it('aborts a request that outlives the timeout and reports failure instead of throwing', async () => {
		const hang = vi.fn(
			(_url: string, init: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init.signal?.addEventListener('abort', () =>
						reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
					);
				})
		);
		const d = deps({ fetch: hang, timeoutMs: 20 });

		const result = await runHousekeepingTick(d);

		expect(result).toEqual({ ok: false });
		expect(d.writeFile).not.toHaveBeenCalled();
		expect(JSON.stringify(d.log.error.mock.calls)).toContain('AbortError');
	});
});
