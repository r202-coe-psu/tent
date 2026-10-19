import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import {
	volunteerTicketFindLimiter,
	volunteerTicketLimiter
} from '$lib/server/security/rate-limiter';

type Handler = (event: {
	request: { json: () => Promise<unknown> };
	fetch: typeof globalThis.fetch;
	getClientAddress: () => string;
}) => Promise<Response>;

const resolve = POST as unknown as Handler;

vi.mock('$lib/server/security/rate-limiter', () => ({
	volunteerTicketFindLimiter: { check: vi.fn(() => true) },
	volunteerTicketLimiter: { check: vi.fn(() => true) }
}));

vi.mock('$env/dynamic/private', () => ({
	env: {
		FASTAPI_INTERNAL_URL: 'http://localhost:9000',
		EXTERNAL_API_SECRET: 'test-external-secret'
	}
}));

const MINTED = 'TKT-VOL-0123456789ABCDEF0123456789ABCDEF';

function call(body: unknown) {
	const fetch = vi.fn().mockResolvedValue({
		ok: true,
		status: 200,
		json: async () => ({ profile: { portal_id: 'P-1' } })
	});
	return {
		response: resolve({
			request: { json: () => Promise.resolve(body) },
			fetch: fetch as unknown as typeof globalThis.fetch,
			getClientAddress: () => '203.0.113.7'
		}),
		fetch
	};
}

describe('POST /api/public/v1/volunteer/access/resolve — rate budget (#625)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(volunteerTicketFindLimiter.check).mockReturnValue(true);
		vi.mocked(volunteerTicketLimiter.check).mockReturnValue(true);
	});

	it('charges a minted token to the token budget, not the strict lookup budget', async () => {
		const result = await call({ token: MINTED }).response;

		expect(result.status).toBe(200);
		expect(volunteerTicketLimiter.check).toHaveBeenCalledWith('203.0.113.7');
		expect(volunteerTicketFindLimiter.check).not.toHaveBeenCalled();
	});

	it('still lets a minted token in when the shelter has spent the strict budget', async () => {
		// The second volunteer at a shelter shares its NAT address with the first.
		vi.mocked(volunteerTicketFindLimiter.check).mockReturnValue(false);

		const result = await call({ token: MINTED }).response;

		expect(result.status).toBe(200);
	});

	it('keeps a phone lookup on the strict budget', async () => {
		vi.mocked(volunteerTicketFindLimiter.check).mockReturnValue(false);
		const { response, fetch } = call({ phone: '0812345678' });
		const result = await response;

		expect(result.status).toBe(429);
		expect(await result.json()).toEqual({ success: false, error: 'RATE_LIMITED' });
		expect(fetch).not.toHaveBeenCalled();
		expect(volunteerTicketLimiter.check).not.toHaveBeenCalled();
	});

	it('keeps a phone on the strict budget even when a minted token rides along', async () => {
		// The body parses as the phone (the token is stripped), so the phone is what gets
		// looked up — it must not borrow the token's looser budget.
		vi.mocked(volunteerTicketFindLimiter.check).mockReturnValue(false);
		const { response, fetch } = call({ phone: '0812345678', token: MINTED });
		const result = await response;

		expect(result.status).toBe(429);
		expect(volunteerTicketLimiter.check).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
	});

	it('keeps a short, guessable code on the strict budget', async () => {
		vi.mocked(volunteerTicketFindLimiter.check).mockReturnValue(false);

		const result = await call({ token: 'TKT-VOL-1001' }).response;

		expect(result.status).toBe(429);
		expect(volunteerTicketLimiter.check).not.toHaveBeenCalled();
	});

	it('answers 422 for a body that is not JSON instead of failing the upstream call', async () => {
		const result = await resolve({
			request: { json: () => Promise.reject(new SyntaxError('bad json')) },
			fetch: vi.fn() as unknown as typeof globalThis.fetch,
			getClientAddress: () => '203.0.113.7'
		});

		expect(result.status).toBe(422);
		expect(volunteerTicketFindLimiter.check).toHaveBeenCalled();
	});
});
