import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';

vi.mock('$lib/server/fastapi', () => ({
	fastapiBaseUrl: vi.fn(() => 'http://fastapi-test:9000'),
	fastapiServiceHeaders: vi.fn(() => ({ Authorization: 'Bearer test' }))
}));

type GetEvent = Parameters<typeof GET>[0];

function eventFor(query: string, fetchMock: ReturnType<typeof vi.fn>): GetEvent {
	return {
		url: new URL(`http://localhost/api/public/v1/shelters${query}`),
		fetch: fetchMock
	} as unknown as GetEvent;
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('GET /api/public/v1/shelters', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn().mockResolvedValue(ok({ shelters: [], count: 0 }));
	});

	const upstream = () => new URL(fetchMock.mock.calls[0][0] as string);

	it('passes the location filters and the radius on', async () => {
		await GET(
			eventFor(
				'?province=สงขลา&district=หาดใหญ่&status=open&lat=7.0&lng=100.5&radius_km=5',
				fetchMock
			)
		);

		const url = upstream();
		expect(url.origin + url.pathname).toBe('http://fastapi-test:9000/public/v1/shelters');
		expect(url.searchParams.get('province')).toBe('สงขลา');
		expect(url.searchParams.get('radius_km')).toBe('5');
		expect(fetchMock.mock.calls[0][1]).toEqual({ headers: { Authorization: 'Bearer test' } });
	});

	it('passes the filters that now run in the database (#1419)', async () => {
		await GET(
			eventFor(
				'?q=โรงเรียน&admin_type=school&hide_full=true&hide_external=true&hide_evacuation=true&hide_host_house=true',
				fetchMock
			)
		);

		const params = upstream().searchParams;
		expect(params.get('q')).toBe('โรงเรียน');
		expect(params.get('admin_type')).toBe('school');
		expect(params.get('hide_full')).toBe('true');
		expect(params.get('hide_external')).toBe('true');
		expect(params.get('hide_evacuation')).toBe('true');
		expect(params.get('hide_host_house')).toBe('true');
	});

	it('keeps every ticked parking type, not just the first', async () => {
		await GET(eventFor('?parking=car&parking=boat', fetchMock));

		expect(upstream().searchParams.getAll('parking')).toEqual(['car', 'boat']);
	});

	it('sends nothing for a filter that is not there', async () => {
		await GET(eventFor('', fetchMock));

		expect([...upstream().searchParams.keys()]).toEqual([]);
	});

	it('does not forward a parameter it does not know', async () => {
		await GET(eventFor('?evil=1&hide_unknown=true', fetchMock));

		expect([...upstream().searchParams.keys()]).toEqual([]);
	});

	it('answers 503 with a code when FastAPI is unreachable', async () => {
		fetchMock.mockRejectedValueOnce(new Error('down'));

		const res = await GET(eventFor('', fetchMock));

		expect(res.status).toBe(503);
		expect((await res.json()).error.code).toBe('SHELTERS_UNAVAILABLE');
	});
});
