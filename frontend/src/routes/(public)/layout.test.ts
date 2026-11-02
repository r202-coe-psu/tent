import { describe, it, expect, vi, afterEach } from 'vitest';
import { load } from './+layout';

type LoadEvent = Parameters<typeof load>[0];

/** A fetch that never answers on its own and rejects once its signal aborts. */
function hangingFetch(): typeof fetch {
	return vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
		return new Promise<Response>((_resolve, reject) => {
			const signal = init?.signal;
			if (signal?.aborted) return reject(signal.reason);
			signal?.addEventListener('abort', () => reject(signal.reason));
		});
	}) as unknown as typeof fetch;
}

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), { status: 200 });
}

/** AbortSignal.timeout runs on a native timer fake timers cannot drive, so expire it at once. */
function expireTimeoutSignals() {
	vi.spyOn(AbortSignal, 'timeout').mockImplementation(() =>
		AbortSignal.abort(new DOMException('The operation timed out.', 'TimeoutError'))
	);
}

async function runLoad(fetchImpl: typeof fetch) {
	return (await load({ fetch: fetchImpl } as unknown as LoadEvent)) as {
		announcements: unknown[];
		configData: Record<string, unknown>;
		faqs: unknown[];
	};
}

describe('(public) layout load', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns empty defaults when both BFF calls hang past the timeout', async () => {
		expireTimeoutSignals();
		vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(runLoad(hangingFetch())).resolves.toEqual({
			announcements: [],
			configData: {},
			faqs: []
		});
	});

	it('keeps the other result when only one call hangs', async () => {
		expireTimeoutSignals();
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const hang = hangingFetch();
		const fetchImpl = vi.fn((url: RequestInfo | URL, init?: RequestInit) =>
			String(url).includes('announcements')
				? hang(url, init)
				: Promise.resolve(jsonResponse({ faqs: [{ id: '1' }], phone_number: '074' }))
		) as unknown as typeof fetch;

		const result = await runLoad(fetchImpl);

		expect(result.announcements).toEqual([]);
		expect(result.faqs).toEqual([{ id: '1' }]);
		expect(result.configData.phone_number).toBe('074');
	});

	it('passes an abort signal to both fetches and returns data on success', async () => {
		const fetchImpl = vi.fn((url: RequestInfo | URL) =>
			Promise.resolve(
				String(url).includes('announcements')
					? jsonResponse({ items: [{ id: 'a1' }] })
					: jsonResponse({ faqs: [{ id: 'f1' }], line_oa_url: 'https://line.me/x' })
			)
		);

		const result = await runLoad(fetchImpl as unknown as typeof fetch);

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		for (const call of fetchImpl.mock.calls as unknown as [string, RequestInit][]) {
			expect(call[1].signal).toBeInstanceOf(AbortSignal);
		}
		expect(result.announcements).toEqual([{ id: 'a1' }]);
		expect(result.faqs).toEqual([{ id: 'f1' }]);
		expect(result.configData.line_oa_url).toBe('https://line.me/x');
	});

	it('returns defaults when a call rejects or answers non-OK', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const fetchImpl = vi.fn((url: RequestInfo | URL) =>
			String(url).includes('announcements')
				? Promise.reject(new TypeError('network'))
				: Promise.resolve(new Response('{}', { status: 500 }))
		) as unknown as typeof fetch;

		const result = await runLoad(fetchImpl);

		expect(result).toEqual({ announcements: [], configData: {}, faqs: [] });
	});
});
