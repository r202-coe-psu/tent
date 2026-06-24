import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { donationPreDeclarationInputSchema } from '$lib/features/donations';
import { donationIpLimiter, donationPhoneLimiter } from '$lib/server/security/rate-limiter';
import { ReCaptchaProvider } from '$lib/server/security/captcha';
import { adminRaw } from '$lib/server/couch-admin';
import { sha256Hex } from '$lib/db/hash';
import { ulid } from '$lib/db/ulid';

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

		// 5. Save to CouchDB (Real database layer)
		const dbName = `shelter_${parsed.data.shelter_code.toLowerCase()}`;
		const nowStr = new Date().toISOString();
		const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
		const docId = `donation:${ulid()}`;

		const doc = {
			_id: docId,
			type: 'donation',
			schema_v: 2,
			shelter_code: parsed.data.shelter_code,
			created_at: nowStr,
			updated_at: nowStr,
			created_by: 'system',
			channel: 'public',
			donor: {
				name: parsed.data.donor.name,
				phone: parsed.data.donor.phone,
				phone_hash: await sha256Hex(parsed.data.donor.phone),
				line_id: null,
				email: null
			},
			kind: 'items',
			items: parsed.data.items_declared.map((item) => {
				let item_id: string | undefined = undefined;
				const name = item.item_name;
				if (name.includes('ข้าว')) {
					item_id = 'item:rice';
				} else if (name.includes('น้ำ')) {
					item_id = 'item:water';
				} else if (name.includes('สบู่')) {
					item_id = 'item:soap';
				} else if (name.includes('ผ้าห่ม')) {
					item_id = 'item:blanket';
				}
				return {
					item_id,
					free_text: item.item_name,
					qty: item.qty,
					unit: item.unit
				};
			}),
			campaign_id: null,
			status: 'declared',
			booking_ref: 'DN-' + Math.floor(100000 + Math.random() * 900000),
			tracking_token_hash: trackingTokenHash,
			declared_at: nowStr,
			received_at: null,
			expires_at: expiresAt,
			logistics: {
				delivery_method: 'self_dropoff'
			}
		};

		const saveRes = await adminRaw(`/${dbName}/${doc._id}`, 'PUT', doc);
		if (saveRes.status >= 400) {
			throw new Error(`Failed to save donation to CouchDB: ${JSON.stringify(saveRes.data)}`);
		}

		console.log('\n--- 📂 [Real CouchDB State: New Donation Created] ---');
		console.log(`Document ID: ${docId}`);
		console.log(`Tracking Token: ${trackingToken}`);
		console.log('-----------------------------------------------------\n');

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


