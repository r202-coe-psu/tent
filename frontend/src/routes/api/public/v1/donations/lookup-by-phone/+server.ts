import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { normalizeThaiPhone } from '$lib/db/model';
import {
	donationPhoneLookupIpLimiter,
	donationPhoneLookupPhoneLimiter,
	donationPhoneLookupSpread
} from '$lib/server/security/rate-limiter';
import { ReCaptchaProvider } from '$lib/server/security/captcha';
import { verifyRecaptchaOrSkip } from '$lib/server/security/recaptcha-gate';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

const captchaProvider = new ReCaptchaProvider(
	env.RECAPTCHA_PROJECT_ID || env.SECRET_RECAPTCHA_KEY || 'smart-shelter-508719'
);

/** A Thai mobile or landline once separators and `+66` are gone. */
const THAI_PHONE = /^0\d{8,9}$/;

/**
 * POST /api/public/v1/donations/lookup-by-phone — CR-173.
 *
 * A phone number alone hands back every booking of it with full access, so this is the
 * route walking through numbers would use. Guards, in order: 5 a minute per IP and 10 an
 * hour per number (FR-7), then a captcha once one IP has tried more than 3 numbers in 5
 * minutes (FR-8). The phone is read from the body only (FR-1). Upstream answers a miss
 * with an empty list, the same shape as a hit (FR-5), and this keeps it that way.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const body = (await request.json().catch(() => null)) as {
		phone?: unknown;
		captcha_token?: unknown;
	} | null;
	const phone = typeof body?.phone === 'string' ? normalizeThaiPhone(body.phone) : '';
	const captchaToken = typeof body?.captcha_token === 'string' ? body.captcha_token : '';
	if (!THAI_PHONE.test(phone)) {
		return json({ success: false, error: 'INVALID_PHONE' }, { status: 422 });
	}

	const ip = getClientAddress();
	if (!donationPhoneLookupIpLimiter.check(ip) || !donationPhoneLookupPhoneLimiter.check(phone)) {
		console.warn(`[donations] phone lookup rate limited ip=${ip}`);
		return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
	}

	if (!donationPhoneLookupSpread.record(ip, phone)) {
		const captcha = await verifyRecaptchaOrSkip({
			token: captchaToken,
			ip,
			action: 'donation_lookup',
			provider: captchaProvider
		});
		if (!captcha.ok) {
			console.warn(`[donations] phone lookup spread over many numbers ip=${ip}`);
			if (captcha.error === 'SERVER_MISCONFIGURED') {
				return json({ success: false, error: captcha.error }, { status: 500 });
			}
			// 403 for a missing token too (FR-8) — the gate's 400 means "malformed".
			return json({ success: false, error: captcha.error }, { status: 403 });
		}
	}

	try {
		const res = await fetch(`${fastapiBaseUrl()}/public/v1/donations/lookup-by-phone`, {
			method: 'POST',
			// FastAPI logs and alerts per source (FR-9); without this every lookup is the BFF's.
			headers: fastapiServiceHeaders({ 'Content-Type': 'application/json', 'X-Real-IP': ip }),
			body: JSON.stringify({ phone })
		});
		if (res.status === 429) {
			return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
		}
		if (!res.ok) {
			return json({ success: false, error: 'LOOKUP_FAILED' }, { status: 502 });
		}
		return json(await res.json(), { headers: { 'Cache-Control': 'no-store' } });
	} catch {
		return json({ success: false, error: 'LOOKUP_FAILED' }, { status: 503 });
	}
};
