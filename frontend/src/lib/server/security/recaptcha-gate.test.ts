import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEnv, mockAppEnv, adminRaw } = vi.hoisted(() => ({
	mockEnv: {
		RECAPTCHA_PROJECT_ID: 'smart-shelter-508719',
		SECRET_RECAPTCHA_KEY: ''
	},
	mockAppEnv: { dev: false },
	adminRaw: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$app/environment', () => ({
	get browser() {
		return false;
	},
	get dev() {
		return mockAppEnv.dev;
	}
}));
vi.mock('$lib/server/couch-admin', () => ({
	adminRaw
}));

import {
	isRecaptchaClientEnabled,
	resolveRecaptchaGate,
	verifyRecaptchaOrSkip
} from './recaptcha-gate';

describe('resolveRecaptchaGate', () => {
	beforeEach(() => {
		adminRaw.mockReset();
		mockEnv.RECAPTCHA_PROJECT_ID = 'smart-shelter-508719';
		mockEnv.SECRET_RECAPTCHA_KEY = '';
		mockAppEnv.dev = false;
	});

	it('returns unconfigured when project/secret keys are placeholders', async () => {
		mockEnv.RECAPTCHA_PROJECT_ID = 'dummy-project-id';
		mockEnv.SECRET_RECAPTCHA_KEY = '';
		await expect(resolveRecaptchaGate()).resolves.toEqual({
			enforce: false,
			reason: 'unconfigured'
		});
		expect(adminRaw).not.toHaveBeenCalled();
	});

	it('returns disabled when config:app.recaptcha_enabled is false', async () => {
		adminRaw.mockResolvedValue({
			status: 200,
			data: { _id: 'config:app', type: 'config', recaptcha_enabled: false }
		});
		await expect(resolveRecaptchaGate()).resolves.toEqual({
			enforce: false,
			reason: 'disabled'
		});
	});

	it('returns enforce when keys are set and flag is missing (default ON)', async () => {
		adminRaw.mockResolvedValue({
			status: 200,
			data: { _id: 'config:app', type: 'config' }
		});
		await expect(resolveRecaptchaGate()).resolves.toEqual({ enforce: true });
	});

	it('defaults to enforce when config:app is missing', async () => {
		adminRaw.mockResolvedValue({ status: 404, data: null });
		await expect(resolveRecaptchaGate()).resolves.toEqual({ enforce: true });
	});
});

describe('verifyRecaptchaOrSkip', () => {
	const provider = {
		verifyToken: vi.fn(async () => true)
	};

	beforeEach(() => {
		adminRaw.mockReset();
		provider.verifyToken.mockReset();
		provider.verifyToken.mockResolvedValue(true);
		mockEnv.RECAPTCHA_PROJECT_ID = 'smart-shelter-508719';
		mockAppEnv.dev = false;
	});

	it('skips when operator disabled the flag even in production', async () => {
		adminRaw.mockResolvedValue({
			status: 200,
			data: { recaptcha_enabled: false }
		});
		await expect(
			verifyRecaptchaOrSkip({
				token: '',
				ip: '1.2.3.4',
				action: 'login',
				provider
			})
		).resolves.toEqual({ ok: true, skipped: true });
		expect(provider.verifyToken).not.toHaveBeenCalled();
	});

	it('requires a token when enforcing', async () => {
		adminRaw.mockResolvedValue({ status: 200, data: { recaptcha_enabled: true } });
		await expect(
			verifyRecaptchaOrSkip({
				token: '',
				ip: '1.2.3.4',
				action: 'login',
				provider
			})
		).resolves.toEqual({ ok: false, error: 'CAPTCHA_REQUIRED', status: 400 });
	});

	it('fails closed in prod when keys are unconfigured', async () => {
		mockEnv.RECAPTCHA_PROJECT_ID = 'dummy-project-id';
		await expect(
			verifyRecaptchaOrSkip({
				token: 'tok',
				ip: '1.2.3.4',
				action: 'login',
				provider
			})
		).resolves.toEqual({ ok: false, error: 'SERVER_MISCONFIGURED', status: 500 });
	});

	it('skips in dev when keys are unconfigured', async () => {
		mockEnv.RECAPTCHA_PROJECT_ID = 'dummy-project-id';
		mockAppEnv.dev = true;
		await expect(
			verifyRecaptchaOrSkip({
				token: '',
				ip: '1.2.3.4',
				action: 'login',
				provider
			})
		).resolves.toEqual({ ok: true, skipped: true });
	});
});

describe('isRecaptchaClientEnabled', () => {
	beforeEach(() => {
		adminRaw.mockReset();
		mockEnv.RECAPTCHA_PROJECT_ID = 'smart-shelter-508719';
	});

	it('is true only when keys + flag are on', async () => {
		adminRaw.mockResolvedValue({ status: 200, data: { recaptcha_enabled: true } });
		await expect(isRecaptchaClientEnabled()).resolves.toBe(true);
	});

	it('is false when flag is off', async () => {
		adminRaw.mockResolvedValue({ status: 200, data: { recaptcha_enabled: false } });
		await expect(isRecaptchaClientEnabled()).resolves.toBe(false);
	});
});
