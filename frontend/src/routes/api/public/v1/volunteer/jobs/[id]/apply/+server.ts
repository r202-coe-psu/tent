import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { volunteerApplySchema } from '$lib/features/volunteer-portal/server';
import { isCaptchaKeyConfigured } from '$lib/features/public-register/server';
import { ReCaptchaProvider } from '$lib/server/security/captcha';
import { verifyRecaptchaOrSkip } from '$lib/server/security/recaptcha-gate';
import {
	volunteerApplyIpLimiter,
	volunteerApplyPhoneLimiter
} from '$lib/server/security/rate-limiter';
import {
	applyPublicVolunteerApplication,
	PublicApplicationError
} from '$lib/features/volunteers/server/public-application';

export const prerender = false;

const captchaProvider = new ReCaptchaProvider(
	env.RECAPTCHA_PROJECT_ID || env.SECRET_RECAPTCHA_KEY || 'smart-shelter-508719'
);
const noStore = { 'Cache-Control': 'no-store' };

/**
 * สมัครงานอาสาแบบไม่ต้องล็อกอิน (CR-092 FR-VOL-02 / AC-VOL-02).
 *
 * No account and no SMS OTP, so spam control is the whole guard: 3 attempts per 10
 * minutes on the IP *and* on the phone number (a phone budget alone is defeated by a
 * new number, an IP budget alone by a phone farm), plus reCAPTCHA Enterprise.
 *
 * CAPTCHA verification uses the shared gate, so the project ID + service-account
 * deployment configuration, operator kill-switch, and production fail-closed behavior
 * match the login and other public BFF routes.
 *
 * The quota move, ticket mint, auto-accept decision and persistence happen through
 * the public CouchDB writer. The captcha token is consumed here and never sent on.
 */
export const POST: RequestHandler = async ({ params, request, getClientAddress }) => {
	const payload = await request.json().catch(() => null);
	const parsed = volunteerApplySchema.safeParse(payload);
	if (!parsed.success) {
		return json(
			{ success: false, error: 'INVALID_INPUT', details: parsed.error.flatten() },
			{ status: 422, headers: noStore }
		);
	}
	const { captchaToken, ...application } = parsed.data;

	const ip = getClientAddress();
	const skipDevGuards =
		dev && !isCaptchaKeyConfigured(env.RECAPTCHA_PROJECT_ID || env.SECRET_RECAPTCHA_KEY);
	if (
		!skipDevGuards &&
		(!volunteerApplyIpLimiter.check(ip) || !volunteerApplyPhoneLimiter.check(application.phone))
	) {
		return json({ success: false, error: 'RATE_LIMITED' }, { status: 429, headers: noStore });
	}

	const captcha = await verifyRecaptchaOrSkip({
		token: captchaToken ?? '',
		ip,
		action: 'volunteer_apply',
		provider: captchaProvider
	});
	if (!captcha.ok) {
		return json(
			{ success: false, error: captcha.error },
			{ status: captcha.status, headers: noStore }
		);
	}

	try {
		const result = await applyPublicVolunteerApplication(params.id, application);
		return json(
			{ success: true, ...result },
			{
				status: 201,
				headers: noStore
			}
		);
	} catch (error) {
		if (error instanceof PublicApplicationError) {
			return json(
				{ success: false, error: error.code },
				{ status: error.httpStatus, headers: noStore }
			);
		}
		console.error('[public-volunteer-apply] direct CouchDB write failed', error);
		return json({ success: false, error: 'APPLY_FAILED' }, { status: 503, headers: noStore });
	}
};
