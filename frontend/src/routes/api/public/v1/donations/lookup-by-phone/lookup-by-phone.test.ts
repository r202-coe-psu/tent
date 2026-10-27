import { describe, it, expect, vi, beforeEach } from 'vitest';

const { verifyRecaptchaOrSkip } = vi.hoisted(() => ({ verifyRecaptchaOrSkip: vi.fn() }));

vi.mock('$lib/server/security/recaptcha-gate', () => ({ verifyRecaptchaOrSkip }));
vi.mock('$lib/server/security/captcha', () => ({
	ReCaptchaProvider: class {
		verifyToken = vi.fn();
	}
}));
// `fastapiServiceHeaders` reads the donor IP off the current request.
vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ getClientAddress: () => '203.0.113.5' })
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
		verifyRecaptchaOrSkip.mockResolvedValue({ ok: true });
	});

	it('passes the bookings through, uncached', async () => {
		upstream();

		const response = await lookup({ phone: '0812345678', captcha_token: 'good' });

		expect(response.status).toBe(200);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(await response.json()).toEqual({ success: true, items: [ITEM] });
	});

	it('answers a number with no bookings in the same shape', async () => {
		upstream([]);

		const response = await lookup({ phone: '0899999999', captcha_token: 'good' });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ success: true, items: [] });
	});

	it('sends the normalized number in the body and the donor IP as X-Real-IP', async () => {
		const fetchMock = upstream();

		await lookup({ phone: '+66 81-234-5678', captcha_token: 'good' });

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
			expect(await response.json()).toEqual({ success: false, error: 'INVALID_PHONE' });
			expect(fetchMock).not.toHaveBeenCalled();
		}
	);

	it('checks the captcha on every lookup, with the donor IP and its own action', async () => {
		upstream();

		await lookup({ phone: '0812345678', captcha_token: 'good' });
		await lookup({ phone: '0899999999', captcha_token: 'good' });

		expect(verifyRecaptchaOrSkip).toHaveBeenCalledTimes(2);
		expect(verifyRecaptchaOrSkip).toHaveBeenCalledWith(
			expect.objectContaining({ token: 'good', ip: '203.0.113.5', action: 'donation_lookup' })
		);
	});

	it('asks for a captcha when none came with the lookup', async () => {
		const fetchMock = upstream();
		verifyRecaptchaOrSkip.mockResolvedValue({
			ok: false,
			error: 'CAPTCHA_REQUIRED',
			status: 400
		});

		const response = await lookup({ phone: '0812345678' });

		expect(verifyRecaptchaOrSkip).toHaveBeenCalledWith(expect.objectContaining({ token: '' }));
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ success: false, error: 'CAPTCHA_REQUIRED' });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('refuses a captcha that does not verify', async () => {
		const fetchMock = upstream();
		verifyRecaptchaOrSkip.mockResolvedValue({ ok: false, error: 'CAPTCHA_FAILED', status: 403 });

		const response = await lookup({ phone: '0812345678', captcha_token: 'bad' });

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ success: false, error: 'CAPTCHA_FAILED' });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('reports a missing captcha configuration as a server error', async () => {
		upstream();
		verifyRecaptchaOrSkip.mockResolvedValue({
			ok: false,
			error: 'SERVER_MISCONFIGURED',
			status: 500
		});

		const response = await lookup({ phone: '0812345678' });

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ success: false, error: 'SERVER_MISCONFIGURED' });
	});

	it('answers 502 when FastAPI refuses', async () => {
		upstream([], 500);

		expect((await lookup({ phone: '0812345678', captcha_token: 'good' })).status).toBe(502);
	});

	it('answers 503 when FastAPI is unreachable', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

		expect((await lookup({ phone: '0812345678', captcha_token: 'good' })).status).toBe(503);
	});
});
