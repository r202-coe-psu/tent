import { describe, it, expect, vi } from 'vitest';
import { GET } from './+server';

vi.mock('$lib/server/fastapi', () => ({
	fastapiBaseUrl: vi.fn(() => 'http://fastapi-test:9000'),
	fastapiServiceHeaders: vi.fn(() => ({ Authorization: 'Bearer test' }))
}));

type GetEvent = Parameters<typeof GET>[0];

function eventWith(fetchImpl: unknown): GetEvent {
	return { fetch: fetchImpl } as unknown as GetEvent;
}

describe('GET /api/public/v1/announcements', () => {
	it('bounds the FastAPI call with an abort signal and passes data through', async () => {
		const fetchImpl = vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({ items: [{ id: 'a1' }], total: 1 })
		});

		const res = await GET(eventWith(fetchImpl));

		expect(res.status).toBe(200);
		expect((await res.json()).items).toHaveLength(1);
		const init = fetchImpl.mock.calls[0][1] as RequestInit;
		expect(init.signal).toBeInstanceOf(AbortSignal);
	});

	it('returns the empty 500 envelope when the upstream call times out', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const timeout = new DOMException('The operation timed out.', 'TimeoutError');
		const fetchImpl = vi.fn().mockRejectedValueOnce(timeout);

		const res = await GET(eventWith(fetchImpl));

		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ items: [], total: 0, page: 1, size: 20, total_pages: 0 });
	});
});
