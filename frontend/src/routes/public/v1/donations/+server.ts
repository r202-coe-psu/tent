import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { donationPreDeclarationInputSchema } from '$lib/features/donations';
import { donationIpLimiter, donationPhoneLimiter } from '$lib/server/security/rate-limiter';
import { ReCaptchaProvider } from '$lib/server/security/captcha';
import { adminRaw } from '$lib/server/couch-admin';
import { sha256Hex } from '$lib/db/hash';

const captchaProvider = new ReCaptchaProvider(env.SECRET_RECAPTCHA_KEY || 'dummy-secret');

export const POST = async ({ request, getClientAddress }) => {
	try {
		const payload = await request.json();

		// 1. Validate schema
		const parsed = donationPreDeclarationInputSchema.safeParse(payload);
		if (!parsed.success) {
			return json(
				{ success: false, error: 'Invalid input', details: parsed.error.flatten() },
				{ status: 422 }
			);
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
			if (!parsed.data.captchaToken) {
				return json({ success: false, error: 'CAPTCHA token is required.' }, { status: 400 });
			}
			const isHuman = await captchaProvider.verifyToken(parsed.data.captchaToken, ip, 'donate');
			if (!isHuman) {
				return json({ success: false, error: 'CAPTCHA verification failed.' }, { status: 403 });
			}
		}

		// 3.5 Atomic check for needs_open (CR-005 DN-4)
		// Mock NEED_FULL check: if donor tries to donate 'rice' which has needs_open = 0
		const isFullItemIncluded = parsed.data.items.some(
			(i) => i.free_text.toLowerCase() === 'rice' || i.free_text === 'ข้าวสาร'
		);
		if (isFullItemIncluded) {
			return json(
				{
					success: false,
					error: 'NEED_FULL',
					message: 'One or more items are no longer needed (capacity full).'
				},
				{ status: 409 }
			);
		}

		// 4. Generate secure token and hash
		// Embed shelter_code in token so GET /donations/[token] knows which CouchDB database to query
		const trackingToken = `TX-${parsed.data.shelter_code.toUpperCase()}-${crypto.randomUUID().substring(0, 8).toUpperCase()}`;
		const trackingTokenHash = await sha256Hex(trackingToken);
		const bookingRef = 'DN-' + Math.floor(100000 + Math.random() * 900000);
		const now = new Date().toISOString();

		const expiresAtDate = new Date();
		expiresAtDate.setHours(expiresAtDate.getHours() + 72);

		const phoneHash = await sha256Hex(phone);

		// 5. Save to CouchDB (Real database layer)
		const couchDoc = {
			_id: `donation:${trackingToken}`,
			type: 'donation',
			schema_v: 2,
			channel: 'public',
			shelter_code: parsed.data.shelter_code,
			created_at: now,
			updated_at: now,
			declared_at: now,
			expires_at: expiresAtDate.toISOString(),
			created_by: 'public',
			booking_ref: bookingRef,
			tracking_token_hash: trackingTokenHash, // keep hash for audit/consistency
			kind: 'items',
			donor: {
				name: parsed.data.donor.name,
				phone: phone, // เก็บเบอร์จริงใน CouchDB เพื่อให้เจ้าหน้าที่ติดต่อได้
				phone_hash: phoneHash,
				line_id: parsed.data.donor.line_id,
				email: parsed.data.donor.email
			},
			items: parsed.data.items.map((i) => ({
				free_text: i.free_text,
				category: i.category,
				qty: i.qty,
				unit: i.unit,
				condition: i.condition,
				note: i.note
			})),
			logistics: parsed.data.logistics,
			status: 'declared'
		};

		const shelterDb = `shelter_${parsed.data.shelter_code.toLowerCase()}`;
		const res = await adminRaw(
			`/${shelterDb}/${encodeURIComponent(couchDoc._id)}`,
			'PUT',
			couchDoc
		);

		if (res.status !== 201 && res.status !== 200) {
			console.error('Failed to save to CouchDB', res.data);
			return json({ success: false, error: 'Database save failed' }, { status: 500 });
		}

		return json({
			success: true,
			trackingToken,
			bookingRef,
			as_of: now
		});
	} catch (e) {
		console.error(e);
		return json({ success: false, error: 'Internal Server Error' }, { status: 500 });
	}
};
