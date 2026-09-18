import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { ReCaptchaProvider } from '$lib/server/security/captcha';
import { verifyRecaptchaOrSkip } from '$lib/server/security/recaptcha-gate';
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

	const result = await verifyRecaptchaOrSkip({
		token: captchaToken,
		ip,
		action: 'login',
		provider: captchaProvider
	});

	if (!result.ok) {
		const clientError =
			result.error === 'SERVER_MISCONFIGURED' ? 'Server configuration error.' : result.error;
		return json({ ok: false, error: clientError }, { status: result.status });
	}

	return json({ ok: true, ...(result.skipped ? { skipped: true } : {}) });
};
