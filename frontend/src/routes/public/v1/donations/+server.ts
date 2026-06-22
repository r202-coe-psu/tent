import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { donationPreDeclarationInputSchema } from '$lib/features/donations';
import { donationIpLimiter, donationPhoneLimiter } from '$lib/server/security/rate-limiter';
import { ReCaptchaProvider } from '$lib/server/security/captcha';
import { saveDonation } from '$lib/server/mongodb';
import { sha256Hex } from '$lib/db/hash';

const captchaProvider = new ReCaptchaProvider(env.SECRET_RECAPTCHA_KEY || 'dummy-secret');

export const POST = async ({ request, getClientAddress }) => {
	try {
		const payload = await request.json();

		// 1. Validate schema
		const parsed = donationPreDeclarationInputSchema.safeParse(payload);
		if (!parsed.success) {
			return json({ success: false, error: 'Invalid input', details: parsed.error.flatten() }, { status: 422 });
		}

		// 2. Rate Limiting Check
		const ip = getClientAddress();
		const phone = parsed.data.donor.phone;

		if (!donationIpLimiter.check(ip)) {
			return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
		}

		if (!donationPhoneLimiter.check(phone)) {
			return json({ success: false, error: 'RATE_LIMITED' }, { status: 429 });
		}

		// 3. CAPTCHA Check (Bypass if dummy secret or in development environment)
		if (!dev && env.SECRET_RECAPTCHA_KEY && env.SECRET_RECAPTCHA_KEY !== 'dummy-secret') {
			const isHuman = await captchaProvider.verifyToken(parsed.data.captchaToken, ip);
			if (!isHuman) {
				return json({ success: false, error: 'CAPTCHA verification failed.' }, { status: 403 });
			}
		}

		// 4. Generate secure token and hash
		const trackingToken = 'TX-DON-' + crypto.randomUUID().substring(0, 8).toUpperCase();
		const trackingTokenHash = await sha256Hex(trackingToken);

		// 5. Save to MongoDB (Real database layer)
		const saved = await saveDonation({
			tracking_token: trackingToken,
			tracking_token_hash: trackingTokenHash,
			shelter_code: parsed.data.shelter_code,
			donor: {
				name: parsed.data.donor.name,
				phone: parsed.data.donor.phone
			},
			items_declared: parsed.data.items_declared
		});
		return json({ 
			success: true, 
			trackingToken,
			as_of: new Date().toISOString()
		});
	} catch (e) {
		console.error(e);
		return json({ success: false, error: 'Internal Server Error' }, { status: 500 });
	}
};


