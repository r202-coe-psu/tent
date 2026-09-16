import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { isCaptchaKeyConfigured } from '$lib/features/public-register';
import { ReCaptchaProvider } from '$lib/server/security/captcha';
import { loginCaptchaIpLimiter } from '$lib/server/security/rate-limiter';

export const prerender = false;

const captchaProvider = new ReCaptchaProvider(
	env.RECAPTCHA_PROJECT_ID || env.SECRET_RECAPTCHA_KEY || 'smart-shelter-508719'
);

/**
 * POST { captchaToken } — Verify reCAPTCHA Enterprise for staff password login.
 * Action must be `login`. Does not create a CouchDB session; the client still
 * calls `/couch/_session` after this gate succeeds.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const ip = getClientAddress();
	if (!loginCaptchaIpLimiter.check(ip)) {
		return json({ ok: false, error: 'RATE_LIMITED' }, { status: 429 });
	}

	const body = (await request.json().catch(() => ({}))) as { captchaToken?: unknown };
	const captchaToken = typeof body.captchaToken === 'string' ? body.captchaToken.trim() : '';

	const captchaConfigured =
		isCaptchaKeyConfigured(env.RECAPTCHA_PROJECT_ID) ||
		isCaptchaKeyConfigured(env.SECRET_RECAPTCHA_KEY);

	if (!captchaConfigured) {
		if (!dev) {
			console.error('reCAPTCHA configuration is missing or is a placeholder!');
			return json({ ok: false, error: 'Server configuration error.' }, { status: 500 });
		}
		console.warn('[dev] reCAPTCHA not configured — skipping CAPTCHA verification');
		return json({ ok: true, skipped: true });
	}

	if (!captchaToken) {
		return json({ ok: false, error: 'CAPTCHA_REQUIRED' }, { status: 400 });
	}

	const isHuman = await captchaProvider.verifyToken(captchaToken, ip, 'login');
	if (!isHuman) {
		return json({ ok: false, error: 'CAPTCHA_FAILED' }, { status: 403 });
	}

	return json({ ok: true });
};
