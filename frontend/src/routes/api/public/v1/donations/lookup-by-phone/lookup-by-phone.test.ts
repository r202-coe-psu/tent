import { describe, it, expect, vi, beforeEach } from 'vitest';

const { limiters, verifyRecaptchaOrSkip } = vi.hoisted(() => ({
	limiters: {
		donationPhoneLookupIpLimiter: { check: vi.fn(() => true) },
		donationPhoneLookupPhoneLimiter: { check: vi.fn(() => true) },
		donationPhoneLookupSpread: { record: vi.fn(() => true) }
	},
	verifyRecaptchaOrSkip: vi.fn()
}));

vi.mock('$lib/server/security/rate-limiter', () => limiters);
vi.mock('$lib/server/security/recaptcha-gate', () => ({ verifyRecaptchaOrSkip }));
vi.mock('$lib/server/security/captcha', () => ({
	ReCaptchaProvider: class {
		verifyToken = vi.fn();
	}
}));
vi.mock('$env/dynamic/private', () => ({
	env: {
		FASTAPI_INTERNAL_URL: 'http://localhost:9000',
		EXTERNAL_API_SECRET: 'test-external-secret'
	}
}));

import { POST } from './+server';

type PostEvent = Parameters<typeof POST>[0];

function lookup(body: unknown) {
	return POST({
		request: { json: async () => body },
		getClientAddress: () => '203.0.113.5'
	} as unknown as PostEvent);
}

const ITEM = {
	tracking_token: 'TX-SH001-ABC',
	booking_ref: 'DN-100001',
	status: 'pending_review',
	shelter_code: 'SH001',
	shelter_name: 'ศูนย์ทดสอบ',
	delivery_method: 'self_dropoff',
	slot: null,
	item_count: 1,
	created_at: '2026-10-19T10:00:00+00:00'
};

function upstream(items: unknown[] = [ITEM], status = 200) {
	const fetchMock = vi.fn().mockResolvedValue({
		ok: status < 400,
		status,
		json: async () => ({ success: true, items })
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

describe('POST /api/public/v1/donations/lookup-by-phone', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.unstubAllGlobals();
		limiters.donationPhoneLookupIpLimiter.check.mockReturnValue(true);
		limiters.donationPhoneLookupPhoneLimiter.check.mockReturnValue(true);
		limiters.donationPhoneLookupSpread.record.mockReturnValue(true);
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	it('passes the bookings through, uncached', async () => {
		upstream();

		const response = await lookup({ phone: '0812345678' });

		expect(response.status).toBe(200);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(await response.json()).toEqual({ success: true, items: [ITEM] });
	});

	it('answers a number with no bookings in the same shape', async () => {
		upstream([]);

		const response = await lookup({ phone: '0899999999' });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ success: true, items: [] });
	});

	it('sends the normalized number in the body and the donor IP as X-Real-IP', async () => {
		const fetchMock = upstream();

		await lookup({ phone: '+66 81-234-5678' });

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('http://localhost:9000/public/v1/donations/lookup-by-phone');
		expect(url).not.toContain('081');
		expect(JSON.parse(init.body)).toEqual({ phone: '0812345678' });
		expect(init.headers).toMatchObject({
			Authorization: 'Bearer test-external-secret',
			'X-Real-IP': '203.0.113.5'
		});
	});

	it.each([{}, { phone: '' }, { phone: 'abc' }, { phone: '12345' }, null])(
		'refuses %j without calling upstream',
		async (body) => {
			const fetchMock = upstream();

			const response = await lookup(body);

			expect(response.status).toBe(422);
			expect(fetchMock).not.toHaveBeenCalled();
		}
	);

	it('limits per IP', async () => {
		const fetchMock = upstream();
		limiters.donationPhoneLookupIpLimiter.check.mockReturnValue(false);

		const response = await lookup({ phone: '0812345678' });

		expect(response.status).toBe(429);
		expect(await response.json()).toEqual({ success: false, error: 'RATE_LIMITED' });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('limits per number, keyed by the normalized form', async () => {
		const fetchMock = upstream();
		limiters.donationPhoneLookupPhoneLimiter.check.mockReturnValue(false);

		const response = await lookup({ phone: '081-234-5678' });

		expect(response.status).toBe(429);
		expect(limiters.donationPhoneLookupPhoneLimiter.check).toHaveBeenCalledWith('0812345678');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('does not ask for a captcha while the IP stays within a few numbers', async () => {
		upstream();

		await lookup({ phone: '0812345678' });

		expect(limiters.donationPhoneLookupSpread.record).toHaveBeenCalledWith(
			'203.0.113.5',
			'0812345678'
		);
		expect(verifyRecaptchaOrSkip).not.toHaveBeenCalled();
	});

	it('asks for a captcha once the IP has spread over too many numbers', async () => {
		const fetchMock = upstream();
		limiters.donationPhoneLookupSpread.record.mockReturnValue(false);
		verifyRecaptchaOrSkip.mockResolvedValue({
			ok: false,
			error: 'CAPTCHA_REQUIRED',
			status: 400
		});

		const response = await lookup({ phone: '0812345678' });

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ success: false, error: 'CAPTCHA_REQUIRED' });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('refuses a captcha that does not verify', async () => {
		upstream();
		limiters.donationPhoneLookupSpread.record.mockReturnValue(false);
		verifyRecaptchaOrSkip.mockResolvedValue({ ok: false, error: 'CAPTCHA_FAILED', status: 403 });

		const response = await lookup({ phone: '0812345678', captcha_token: 'bad' });

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ success: false, error: 'CAPTCHA_FAILED' });
	});

	it('goes ahead once the captcha verifies', async () => {
		upstream();
		limiters.donationPhoneLookupSpread.record.mockReturnValue(false);
		verifyRecaptchaOrSkip.mockResolvedValue({ ok: true });

		const response = await lookup({ phone: '0812345678', captcha_token: 'good' });

		expect(response.status).toBe(200);
		expect(verifyRecaptchaOrSkip).toHaveBeenCalledWith(
			expect.objectContaining({ token: 'good', ip: '203.0.113.5', action: 'donation_lookup' })
		);
	});

	it('maps an upstream 429 through and anything else to 502', async () => {
		upstream([], 429);
		expect((await lookup({ phone: '0812345678' })).status).toBe(429);

		upstream([], 500);
		expect((await lookup({ phone: '0812345678' })).status).toBe(502);
	});

	it('answers 503 when FastAPI is unreachable', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

		expect((await lookup({ phone: '0812345678' })).status).toBe(503);
	});
});
