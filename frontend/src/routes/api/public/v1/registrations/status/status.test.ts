import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST, GET } from './+server';
import { adminRaw } from '$lib/server/couch-admin';
import { listShelterMasters } from '$lib/server/shelters.admin';
import { registerLookupIpLimiter } from '$lib/server/security/rate-limiter';

type PostEvent = Parameters<typeof POST>[0];
type GetEvent = Parameters<typeof GET>[0];

vi.mock('$lib/server/couch-admin', () => ({ adminRaw: vi.fn() }));

vi.mock('$lib/server/shelters.admin', () => ({
	listShelterMasters: vi.fn()
}));

vi.mock('$lib/server/security/rate-limiter', () => ({
	registerLookupIpLimiter: { check: vi.fn(() => true) }
}));

const ULID = '01JABCDEFGHJKMNPQRSTVWXYZ0';
const DOC_ID = `evacuee:${ULID}`;

function postEvent(body: unknown): PostEvent {
	return {
		request: new Request('http://localhost/api/public/v1/registrations/status', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}),
		getClientAddress: () => '203.0.113.9',
		fetch: vi.fn()
	} as unknown as PostEvent;
}

function getEvent(code: string): GetEvent {
	return {
		url: new URL(
			`http://localhost/api/public/v1/registrations/status?code=${encodeURIComponent(code)}`
		),
		getClientAddress: () => '203.0.113.9',
		fetch: vi.fn()
	} as unknown as GetEvent;
}

describe('POST /api/public/v1/registrations/status', () => {
	beforeEach(() => {
		vi.mocked(adminRaw).mockReset();
		vi.mocked(listShelterMasters).mockReset();
		vi.mocked(registerLookupIpLimiter.check).mockReturnValue(true);
		vi.mocked(listShelterMasters).mockResolvedValue([{ code: 'SH001' }] as never);
	});

	it('returns 422 on empty or invalid input', async () => {
		const res = await POST(postEvent({}));
		expect(res.status).toBe(422);
	});

	it('returns 429 when rate limited', async () => {
		vi.mocked(registerLookupIpLimiter.check).mockReturnValue(false);
		const res = await POST(postEvent({ code: ULID }));
		expect(res.status).toBe(429);
	});

	it('returns verified: false when stay status is pre_registered', async () => {
		vi.mocked(adminRaw).mockResolvedValue({
			status: 200,
			data: {
				_id: DOC_ID,
				type: 'evacuee',
				current_stay: { status: 'pre_registered' }
			}
		});

		const res = await POST(postEvent({ code: ULID }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({
			success: true,
			verified: false,
			status: 'pre_registered'
		});
	});

	it('returns verified: true when stay status is arriving or active (confirmed)', async () => {
		vi.mocked(adminRaw).mockResolvedValue({
			status: 200,
			data: {
				_id: DOC_ID,
				type: 'evacuee',
				current_stay: { status: 'arriving' }
			}
		});

		const res = await POST(postEvent({ code: ULID }));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({
			success: true,
			verified: true,
			status: 'arriving'
		});
	});

	it('works with GET ?code=...', async () => {
		vi.mocked(adminRaw).mockResolvedValue({
			status: 200,
			data: {
				_id: DOC_ID,
				type: 'evacuee',
				current_stay: { status: 'active' }
			}
		});

		const res = await GET(getEvent(ULID));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({
			success: true,
			verified: true,
			status: 'active'
		});
	});

	describe('unassigned (central-queue) ticket via FastAPI', () => {
		function jsonRes(status: number, body: unknown) {
			return { ok: status >= 200 && status < 300, status, json: async () => body };
		}

		async function call(fetchMock: ReturnType<typeof vi.fn>) {
			vi.mocked(adminRaw).mockResolvedValue({ status: 404, data: null });
			const event = postEvent({ code: ULID });
			event.fetch = fetchMock as unknown as typeof fetch;
			return POST(event);
		}

		it('calls the service-auth /public status route (not the staff detail route)', async () => {
			const fetchMock = vi
				.fn()
				.mockResolvedValue(jsonRes(200, { id: ULID, status: 'open', claimed: false }));
			await call(fetchMock);
			const url = String(fetchMock.mock.calls[0][0]);
			expect(url).toContain(`/public/v1/unassigned-registrations/${ULID}/status`);
			expect(url).not.toContain('/staff/');
		});

		it('returns verified: false for an open (pending / partially claimed) doc', async () => {
			const res = await call(
				vi.fn().mockResolvedValue(jsonRes(200, { id: ULID, status: 'open', claimed: false }))
			);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ success: true, verified: false, status: 'open' });
		});

		it('returns verified: true when FastAPI reports claimed: true', async () => {
			const res = await call(
				vi.fn().mockResolvedValue(jsonRes(200, { id: ULID, status: 'closed', claimed: true }))
			);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ success: true, verified: true, status: 'closed' });
		});

		it('maps a real 404 to notFound', async () => {
			const res = await call(vi.fn().mockResolvedValue(jsonRes(404, {})));
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.notFound).toBe(true);
			expect(body.verified).toBe(false);
		});

		it.each([401, 403, 500, 503])(
			'returns 502 STATUS_UNAVAILABLE (no notFound) when upstream answers %i',
			async (status) => {
				const res = await call(vi.fn().mockResolvedValue(jsonRes(status, {})));
				expect(res.status).toBe(502);
				const body = await res.json();
				expect(body).toEqual({ success: false, verified: false, error: 'STATUS_UNAVAILABLE' });
				expect(body).not.toHaveProperty('notFound');
			}
		);

		it('returns 502 STATUS_UNAVAILABLE (no notFound) when fetch throws', async () => {
			const res = await call(vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
			expect(res.status).toBe(502);
			const body = await res.json();
			expect(body.error).toBe('STATUS_UNAVAILABLE');
			expect(body).not.toHaveProperty('notFound');
		});
	});

	it('returns 200 with notFound: true when ticket is not found in Couch or Mongo', async () => {
		vi.mocked(adminRaw).mockResolvedValue({ status: 404, data: null });
		const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
		const event = postEvent({ code: ULID });
		event.fetch = fetchMock;

		const res = await POST(event);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.notFound).toBe(true);
		expect(body.verified).toBe(false);
		expect(body.error).toBe('BOOKING_NOT_FOUND');
	});
});
