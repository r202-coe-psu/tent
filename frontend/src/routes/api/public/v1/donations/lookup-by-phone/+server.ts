import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { normalizeThaiPhone } from '$lib/db/model';
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
 * route walking through numbers would use. Every call must pass a captcha (FR-8): that
 * covers "one IP, many numbers" without per-IP state in the app, which CR-188 removed.
 * Request rate is nginx's (`public_write`). The phone is read from the body only (FR-1).
 * Upstream answers a miss with an empty list, the same shape as a hit (FR-5), and this
 * keeps it that way.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const body = (await request.json().catch(() => null)) as {
		phone?: unknown;
		captcha_token?: unknown;
	} | null;
	const phone = typeof body?.phone === 'string' ? normalizeThaiPhone(body.phone) : '';
	if (!THAI_PHONE.test(phone)) {
		return json({ success: false, error: 'INVALID_PHONE' }, { status: 422 });
	}

	const ip = getClientAddress();
	const captcha = await verifyRecaptchaOrSkip({
		token: typeof body?.captcha_token === 'string' ? body.captcha_token : '',
		ip,
		action: 'donation_lookup',
		provider: captchaProvider
	});
	if (!captcha.ok) {
		// 403 for a missing token too (FR-8) — the gate's 400 means "malformed".
		const status = captcha.error === 'SERVER_MISCONFIGURED' ? 500 : 403;
		return json({ success: false, error: captcha.error }, { status });
	}

	try {
		const res = await fetch(`${fastapiBaseUrl()}/public/v1/donations/lookup-by-phone`, {
			method: 'POST',
			// The service headers carry the donor IP as X-Real-IP: FastAPI logs and alerts per
			// source (FR-9), and without it every lookup would be the BFF's.
			headers: fastapiServiceHeaders({ 'Content-Type': 'application/json' }),
			body: JSON.stringify({ phone })
		});
		if (!res.ok) {
			return json({ success: false, error: 'LOOKUP_FAILED' }, { status: 502 });
		}
		return json(await res.json(), { headers: { 'Cache-Control': 'no-store' } });
	} catch {
		return json({ success: false, error: 'LOOKUP_FAILED' }, { status: 503 });
	}
};
