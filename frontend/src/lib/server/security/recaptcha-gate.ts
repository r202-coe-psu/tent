import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { APP_CONFIG_DEFAULTS, APP_CONFIG_DOC_ID, readAppConfig } from '$lib/features/shared';
import { isCaptchaKeyConfigured } from '$lib/features/public-register/server';
import { adminRaw } from '$lib/server/couch-admin';
import type { CaptchaProvider } from '$lib/server/security/captcha';

export type RecaptchaGate =
	{ enforce: false; reason: 'unconfigured' | 'disabled' } | { enforce: true };

function keysConfigured(): boolean {
	return (
		isCaptchaKeyConfigured(env.RECAPTCHA_PROJECT_ID) ||
		isCaptchaKeyConfigured(env.SECRET_RECAPTCHA_KEY)
	);
}

/**
 * Resolve whether this request must verify a reCAPTCHA token.
 *
 * - Keys missing → `unconfigured` (dev may skip; prod should fail closed).
 * - Keys present but `config:app.recaptcha_enabled === false` → `disabled` (skip even in prod).
 * - Otherwise → `enforce`.
 */
export async function resolveRecaptchaGate(): Promise<RecaptchaGate> {
	if (!keysConfigured()) {
		return { enforce: false, reason: 'unconfigured' };
	}

	try {
		const { status, data } = await adminRaw(
			`/registry/${encodeURIComponent(APP_CONFIG_DOC_ID)}`,
			'GET'
		);
		const config = status === 200 ? readAppConfig(data) : APP_CONFIG_DEFAULTS;
		if (!config.recaptcha_enabled) {
			return { enforce: false, reason: 'disabled' };
		}
		return { enforce: true };
	} catch (err) {
		console.warn('[reCAPTCHA] Failed to read config:app — defaulting to enabled', err);
		return { enforce: true };
	}
}

/** Public/client status: enabled only when keys are configured and the operator flag is ON. */
export async function isRecaptchaClientEnabled(): Promise<boolean> {
	const gate = await resolveRecaptchaGate();
	return gate.enforce;
}

export type RecaptchaVerifyFailure = {
	ok: false;
	error: 'SERVER_MISCONFIGURED' | 'CAPTCHA_REQUIRED' | 'CAPTCHA_FAILED';
	status: 400 | 403 | 500;
};

export type RecaptchaVerifySuccess = { ok: true; skipped?: boolean };

/**
 * Shared CAPTCHA gate for BFF routes. Call after rate-limit checks.
 */
export async function verifyRecaptchaOrSkip(options: {
	token: string;
	ip: string;
	action: string;
	provider: CaptchaProvider;
}): Promise<RecaptchaVerifySuccess | RecaptchaVerifyFailure> {
	const gate = await resolveRecaptchaGate();

	if (!gate.enforce) {
		if (gate.reason === 'unconfigured') {
			if (!dev) {
				console.error('reCAPTCHA configuration is missing or is a placeholder!');
				return { ok: false, error: 'SERVER_MISCONFIGURED', status: 500 };
			}
			console.warn('[dev] reCAPTCHA not configured — skipping CAPTCHA verification');
			return { ok: true, skipped: true };
		}
		// Operator disabled — skip even in production.
		return { ok: true, skipped: true };
	}

	if (!options.token) {
		return { ok: false, error: 'CAPTCHA_REQUIRED', status: 400 };
	}

	const isHuman = await options.provider.verifyToken(options.token, options.ip, options.action);
	if (!isHuman) {
		return { ok: false, error: 'CAPTCHA_FAILED', status: 403 };
	}

	return { ok: true };
}
