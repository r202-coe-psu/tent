import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

import {
	isCaptchaKeyConfigured,
	toUnassignedRegistrationPayload,
	unassignedRegistrationInputSchema
} from '$lib/features/public-register/server';
import { fastapiBaseUrl, fastapiServiceHeaders, unwrapFastapiError } from '$lib/server/fastapi';
import { ReCaptchaProvider } from '$lib/server/security/captcha';
import { registerIpLimiter, registerPhoneLimiter } from '$lib/server/security/rate-limiter';

export const prerender = false;

const captchaProvider = new ReCaptchaProvider(env.SECRET_RECAPTCHA_KEY || 'dummy-secret');
const noStore = { 'Cache-Control': 'no-store' };

/**
 * POST /api/public/v1/unassigned-registrations — public pre-reg without shelter (CR-113).
 *
 * Browser never talks to FastAPI or Couch with staff credentials: captcha + rate
 * limits live here; persistence is Bearer `EXTERNAL_API_SECRET` → FastAPI → Mongo only.
 */
export const POST: RequestHandler = async ({ request, getClientAddress, fetch }) => {
	const payload = await request.json().catch(() => null);

	const parsed = unassignedRegistrationInputSchema.safeParse(payload);
	if (!parsed.success) {
		return json(
			{ success: false, error: 'INVALID_INPUT', details: parsed.error.flatten() },
			{ status: 422, headers: noStore }
		);
	}
	const input = parsed.data;

	const ip = getClientAddress();
	const contactPhone = input.phone ?? input.members[0]?.phone ?? '';
	if (!registerIpLimiter.check(ip) || (contactPhone && !registerPhoneLimiter.check(contactPhone))) {
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
		if (!input.captchaToken) {
			return json({ success: false, error: 'CAPTCHA_REQUIRED' }, { status: 400, headers: noStore });
		}
		if (!(await captchaProvider.verifyToken(input.captchaToken, ip, 'unassigned_register'))) {
			return json({ success: false, error: 'CAPTCHA_FAILED' }, { status: 403, headers: noStore });
		}
	}

	const upstreamBody = toUnassignedRegistrationPayload(input);

	let apiRes: Response;
	try {
		apiRes = await fetch(`${fastapiBaseUrl()}/public/v1/unassigned-registrations`, {
			method: 'POST',
			headers: fastapiServiceHeaders({ 'Content-Type': 'application/json' }),
			body: JSON.stringify(upstreamBody)
		});
	} catch {
		return json({ success: false, error: 'WRITE_FAILED' }, { status: 502, headers: noStore });
	}

	if (!apiRes.ok) {
		const errBody = await apiRes.json().catch(() => ({}));
		return json(
			{ success: false, ...unwrapFastapiError(errBody) },
			{ status: apiRes.status, headers: noStore }
		);
	}

	const created = (await apiRes.json()) as Record<string, unknown>;
	return json({ success: true, ...created }, { status: 201, headers: noStore });
};
