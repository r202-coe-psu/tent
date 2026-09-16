import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import { loginCaptchaIpLimiter } from '$lib/server/security/rate-limiter';

type PostEvent = Parameters<typeof POST>[0];

const verifyToken = vi.fn<(token: string, ip?: string, action?: string) => Promise<boolean>>();

vi.mock('$lib/server/security/captcha', () => ({
	ReCaptchaProvider: class {
		verifyToken(token: string, ip?: string, action?: string) {
			return verifyToken(token, ip, action);
		}
	}
}));

vi.mock('$lib/server/security/rate-limiter', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/security/rate-limiter')>();
	return {
		...actual,
		loginCaptchaIpLimiter: { check: vi.fn(() => true) }
	};
});

vi.mock('$env/dynamic/private', () => ({
	env: {
		RECAPTCHA_PROJECT_ID: 'smart-shelter-508719',
		SECRET_RECAPTCHA_KEY: ''
	}
}));

vi.mock('$app/environment', () => ({
	browser: false,
	dev: false,
	building: false,
	version: 'test'
}));

function makeEvent(body: unknown, ip = '127.0.0.1'): PostEvent {
	return {
		request: new Request('http://localhost/api/v1/auth/captcha/verify', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}),
		getClientAddress: () => ip
	} as PostEvent;
}

describe('POST /api/v1/auth/captcha/verify', () => {
	beforeEach(() => {
		verifyToken.mockReset();
		verifyToken.mockResolvedValue(true);
		vi.mocked(loginCaptchaIpLimiter.check).mockReturnValue(true);
	});

	it('returns ok when token verifies with action login', async () => {
		const res = await POST(makeEvent({ captchaToken: 'tok-1' }));
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ ok: true });
		expect(verifyToken).toHaveBeenCalledWith('tok-1', '127.0.0.1', 'login');
	});

	it('returns CAPTCHA_REQUIRED when token missing', async () => {
		const res = await POST(makeEvent({}));
		expect(res.status).toBe(400);
		await expect(res.json()).resolves.toEqual({ ok: false, error: 'CAPTCHA_REQUIRED' });
		expect(verifyToken).not.toHaveBeenCalled();
	});

	it('returns CAPTCHA_FAILED when provider rejects', async () => {
		verifyToken.mockResolvedValue(false);
		const res = await POST(makeEvent({ captchaToken: 'bad' }));
		expect(res.status).toBe(403);
		await expect(res.json()).resolves.toEqual({ ok: false, error: 'CAPTCHA_FAILED' });
	});

	it('returns RATE_LIMITED when IP budget exhausted', async () => {
		vi.mocked(loginCaptchaIpLimiter.check).mockReturnValue(false);
		const res = await POST(makeEvent({ captchaToken: 'tok-1' }));
		expect(res.status).toBe(429);
		await expect(res.json()).resolves.toEqual({ ok: false, error: 'RATE_LIMITED' });
		expect(verifyToken).not.toHaveBeenCalled();
	});
});
