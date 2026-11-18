import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';

vi.mock('$lib/server/fastapi', () => ({
	fastapiBaseUrl: vi.fn(() => 'http://fastapi-test:9000'),
	fastapiServiceHeaders: vi.fn(() => ({ Authorization: 'Bearer test' }))
}));

type GetEvent = Parameters<typeof GET>[0];

function eventFor(query: string, fetchMock: ReturnType<typeof vi.fn>): GetEvent {
	return {
		url: new URL(`http://localhost/api/public/v1/shelters/summary${query}`),
		fetch: fetchMock
	} as unknown as GetEvent;
}

describe('GET /api/public/v1/shelters/summary', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					shelters_total: 9,
					shelters_open: 6,
					counts_by_site_kind: { evacuation_center: 9 }
				}),
				{ status: 200 }
			)
		);
	});

	it('asks FastAPI for the summary with the service secret and relays the answer', async () => {
		const res = await GET(eventFor('', fetchMock));

		const url = new URL(fetchMock.mock.calls[0][0] as string);
		expect(url.origin + url.pathname).toBe('http://fastapi-test:9000/public/v1/shelters/summary');
		expect(fetchMock.mock.calls[0][1]).toEqual({ headers: { Authorization: 'Bearer test' } });
		expect(res.status).toBe(200);
		expect((await res.json()).shelters_total).toBe(9);
		expect(res.headers.get('Cache-Control')).toContain('max-age');
	});

	it('passes hide_host_house on and nothing else', async () => {
		await GET(eventFor('?hide_host_house=true&q=ignored&lat=7', fetchMock));

		const params = new URL(fetchMock.mock.calls[0][0] as string).searchParams;
		expect(params.get('hide_host_house')).toBe('true');
		expect([...params.keys()]).toEqual(['hide_host_house']);
	});

	it('answers 503 with a code when FastAPI is unreachable', async () => {
		fetchMock.mockRejectedValueOnce(new Error('down'));

		const res = await GET(eventFor('', fetchMock));

		expect(res.status).toBe(503);
		expect((await res.json()).error.code).toBe('SHELTERS_UNAVAILABLE');
	});
});
