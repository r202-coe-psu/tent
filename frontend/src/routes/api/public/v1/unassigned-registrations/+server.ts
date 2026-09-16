import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

import {
	executeUnassignedRegistration,
	UnassignedRegistrationWriteError
} from '$lib/features/public-register/execute-unassigned-registration.server';
import {
	isCaptchaKeyConfigured,
	publicUnassignedRegistrationRequestSchema
} from '$lib/features/public-register/server';
import { ReCaptchaProvider } from '$lib/server/security/captcha';
import { registerIpLimiter, registerPhoneLimiter } from '$lib/server/security/rate-limiter';

export const prerender = false;

const captchaProvider = new ReCaptchaProvider(
	env.RECAPTCHA_PROJECT_ID || env.SECRET_RECAPTCHA_KEY || 'smart-shelter-508719'
);
const noStore = { 'Cache-Control': 'no-store' };

/**
 * POST /api/public/v1/unassigned-registrations — public pre-reg without shelter (#255 / CR-113).
 *
 * Browser never talks to FastAPI or Couch with staff credentials: captcha + rate
 * limits live here; persistence is Bearer `EXTERNAL_API_SECRET` → FastAPI → Mongo only
 * via `executeUnassignedRegistration` (UnifiedRegistrationInput → Mongo executor).
 */
export const POST: RequestHandler = async ({ request, getClientAddress, fetch }) => {
	const payload = await request.json().catch(() => null);

	const parsed = publicUnassignedRegistrationRequestSchema.safeParse(payload);
	if (!parsed.success) {
		return json(
			{ success: false, error: 'INVALID_INPUT', details: parsed.error.flatten() },
			{ status: 422, headers: noStore }
		);
	}
	const input = parsed.data;

	if (input.disclaimerAcknowledged !== true) {
		return json(
			{ success: false, error: 'DISCLAIMER_REQUIRED' },
			{ status: 400, headers: noStore }
		);
	}

	const ip = getClientAddress();
	const contactPhone = input.members[0]?.phone ?? '';
	if (!registerIpLimiter.check(ip) || (contactPhone && !registerPhoneLimiter.check(contactPhone))) {
		return json({ success: false, error: 'RATE_LIMITED' }, { status: 429, headers: noStore });
	}

	const captchaConfigured =
		isCaptchaKeyConfigured(env.RECAPTCHA_PROJECT_ID) ||
		isCaptchaKeyConfigured(env.SECRET_RECAPTCHA_KEY);
	if (!captchaConfigured) {
		if (!dev) {
			console.error('reCAPTCHA configuration is missing or is a placeholder!');
			return json(
				{ success: false, error: 'SERVER_MISCONFIGURED' },
				{ status: 500, headers: noStore }
			);
		}
		console.warn('[dev] reCAPTCHA not configured — skipping CAPTCHA verification');
	} else {
		if (!input.captchaToken) {
			return json({ success: false, error: 'CAPTCHA_REQUIRED' }, { status: 400, headers: noStore });
		}
		if (!(await captchaProvider.verifyToken(input.captchaToken, ip, 'unassigned_register'))) {
			return json({ success: false, error: 'CAPTCHA_FAILED' }, { status: 403, headers: noStore });
		}
	}

	try {
		const created = await executeUnassignedRegistration(
			{ members: input.members, household: input.household },
			{ fetch }
		);
		return json({ ...created, success: true }, { status: 201, headers: noStore });
	} catch (err) {
		if (err instanceof UnassignedRegistrationWriteError) {
			return json(
				{ success: false, error: err.message, ...(err.upstream ?? {}) },
				{ status: err.status, headers: noStore }
			);
		}
		return json({ success: false, error: 'WRITE_FAILED' }, { status: 502, headers: noStore });
	}
};
