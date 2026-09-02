import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { volunteerApplySchema } from '$lib/features/volunteer-portal/server';
import { isCaptchaKeyConfigured } from '$lib/features/public-register/server';
import { ReCaptchaProvider } from '$lib/server/security/captcha';
import {
	volunteerApplyIpLimiter,
	volunteerApplyPhoneLimiter
} from '$lib/server/security/rate-limiter';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

export const prerender = false;

const captchaProvider = new ReCaptchaProvider(env.SECRET_RECAPTCHA_KEY || 'dummy-secret');
const noStore = { 'Cache-Control': 'no-store' };

/**
 * สมัครงานอาสาแบบไม่ต้องล็อกอิน (CR-092 FR-VOL-02 / AC-VOL-02).
 *
 * No account and no SMS OTP, so spam control is the whole guard: 3 attempts per 10
 * minutes on the IP *and* on the phone number (a phone budget alone is defeated by a
 * new number, an IP budget alone by a phone farm), plus reCAPTCHA v3.
 *
 * CAPTCHA fails OPEN only when `dev` and no real key is configured, so a developer
 * without Google keys can still run the flow; production fails CLOSED, so a deploy that
 * forgets the secret is rejected rather than silently unguarded — same rule as
 * `/api/public/v1/registrations`.
 *
 * The quota move, the ticket mint and the auto-accept decision all live upstream
 * (`VolunteersUseCase.apply`); this route validates, throttles and forwards. The
 * captcha token is consumed here and never sent on.
 */
export const POST: RequestHandler = async ({ params, request, fetch, getClientAddress }) => {
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
	if (!volunteerApplyIpLimiter.check(ip) || !volunteerApplyPhoneLimiter.check(application.phone)) {
		return json({ success: false, error: 'RATE_LIMITED' }, { status: 429, headers: noStore });
	}

	if (!isCaptchaKeyConfigured(env.SECRET_RECAPTCHA_KEY)) {
		if (!dev) {
			console.error('SECRET_RECAPTCHA_KEY is missing or is a placeholder!');
			return json(
				{ success: false, error: 'SERVER_MISCONFIGURED' },
				{ status: 500, headers: noStore }
			);
		}
		console.warn('[dev] SECRET_RECAPTCHA_KEY not configured — skipping CAPTCHA verification');
	} else {
		if (!captchaToken) {
			return json({ success: false, error: 'CAPTCHA_REQUIRED' }, { status: 400, headers: noStore });
		}
		if (!(await captchaProvider.verifyToken(captchaToken, ip, 'volunteer_apply'))) {
			return json({ success: false, error: 'CAPTCHA_FAILED' }, { status: 403, headers: noStore });
		}
	}

	try {
		const res = await fetch(
			`${fastapiBaseUrl()}/public/v1/jobs/${encodeURIComponent(params.id)}/apply`,
			{
				method: 'POST',
				headers: fastapiServiceHeaders({ 'Content-Type': 'application/json' }),
				body: JSON.stringify(application)
			}
		);
		const body = await res.json().catch(() => null);
		if (!res.ok) {
			// Upstream refusals are the applicant's business — a full job or a closed board
			// has to reach the form as itself, not as a generic failure.
			const detail = (body as { detail?: { error?: string } } | null)?.detail;
			return json(
				{ success: false, error: detail?.error ?? 'APPLY_FAILED' },
				{ status: res.status >= 400 && res.status < 500 ? res.status : 502, headers: noStore }
			);
		}
		return json(body, { headers: noStore });
	} catch {
		return json({ success: false, error: 'APPLY_FAILED' }, { status: 503, headers: noStore });
	}
};
