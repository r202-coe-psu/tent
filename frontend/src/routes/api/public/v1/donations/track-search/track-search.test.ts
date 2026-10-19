import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';

type PostEvent = Parameters<typeof POST>[0];

const limiters = vi.hoisted(() => ({
	donationIpLimiter: { check: vi.fn(() => true) },
	donationTrackSearchLimiter: { check: vi.fn(() => true) }
}));
vi.mock('$lib/server/security/rate-limiter', () => limiters);

vi.mock('$env/dynamic/private', () => ({
	env: {
		FASTAPI_INTERNAL_URL: 'http://localhost:9000',
		EXTERNAL_API_SECRET: 'test-external-secret'
	}
}));

describe('POST /api/public/v1/donations/track-search', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.unstubAllGlobals();
		limiters.donationIpLimiter.check.mockReturnValue(true);
		limiters.donationTrackSearchLimiter.check.mockReturnValue(true);
	});

	function search() {
		return POST({
			request: { json: async () => ({ booking_ref: 'DN-905176', phone: '0812345678' }) },
			getClientAddress: () => '203.0.113.1'
		} as unknown as PostEvent);
	}

	it('returns tracking token from FastAPI', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({
					success: true,
					tracking_token: 'TX-SH001-ABC',
					booking_ref: 'DN-905176'
				})
			})
		);

		const response = await POST({
			request: {
				json: async () => ({ booking_ref: 'DN-905176', phone: '0812345678' })
			},
			getClientAddress: () => '127.0.0.1'
		} as unknown as PostEvent);

		const data = await response.json();
		expect(response.status).toBe(200);
		expect(data.trackingToken).toBe('TX-SH001-ABC');
		expect(data.bookingRef).toBe('DN-905176');
	});

	it('rejects missing fields', async () => {
		const response = await POST({
			request: { json: async () => ({ booking_ref: 'DN-905176' }) },
			getClientAddress: () => '127.0.0.1'
		} as unknown as PostEvent);
		expect(response.status).toBe(400);
	});

	// #459 — looking a booking up must not spend the budget for making one.
	it('counts against its own limiter, not the booking one', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({ tracking_token: 'TX-SH001-ABC', booking_ref: 'DN-905176' })
			})
		);

		await search();

		expect(limiters.donationTrackSearchLimiter.check).toHaveBeenCalledWith('203.0.113.1');
		expect(limiters.donationIpLimiter.check).not.toHaveBeenCalled();
	});

	it('answers 429 once its own limiter is spent', async () => {
		limiters.donationTrackSearchLimiter.check.mockReturnValue(false);
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		const response = await search();

		expect(response.status).toBe(429);
		expect(await response.json()).toEqual({ success: false, error: 'RATE_LIMITED' });
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
