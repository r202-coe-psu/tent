import { json } from '@sveltejs/kit';
import { randomInt } from 'node:crypto';
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

		// 3. CAPTCHA Check (Fail-closed in production)
		if (!dev) {
			if (!env.SECRET_RECAPTCHA_KEY || env.SECRET_RECAPTCHA_KEY === 'dummy-secret') {
				console.error('SECRET_RECAPTCHA_KEY is missing or invalid in production!');
				return json({ success: false, error: 'Server configuration error.' }, { status: 500 });
			}
			if (!parsed.data.captchaToken) {
				return json({ success: false, error: 'CAPTCHA token is required.' }, { status: 400 });
			}
			const isHuman = await captchaProvider.verifyToken(parsed.data.captchaToken, ip, 'donate');
			if (!isHuman) {
				return json({ success: false, error: 'CAPTCHA verification failed.' }, { status: 403 });
			}
		}

		// 3.5 Atomic check for needs_open (CR-005 DN-4)
		// TODO: Implement actual check with CouchDB view to prevent over-donating items
		// The mock check has been removed as it blocks legitimate donations.

		// 4. Generate secure token and hash
		// Embed shelter_code in token so GET /donations/[token] knows which CouchDB database to query
		const trackingToken = `TX-${parsed.data.shelter_code.toUpperCase()}-${crypto.randomUUID().substring(0, 8).toUpperCase()}`;
		const bookingRef = 'DN-' + randomInt(100000, 1000000);
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
			tracking_token: trackingToken, // store token directly as requested
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

		// Use dedicated limited-permission user for public writes instead of admin
		const writerUrl = env.COUCHDB_PUBLIC_WRITER_URL;
		let resStatus = 500;
		let resData = null;

		if (writerUrl) {
			const match = writerUrl.match(/^(https?:\/\/)([^:]+):([^@]+)@(.+)$/);
			if (match) {
				const [, scheme, user, pass, host] = match;
				const base = `${scheme}${host}`.replace(/\/$/, '');
				const authHeader = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

				const fetchRes = await fetch(`${base}/${shelterDb}/${encodeURIComponent(couchDoc._id)}`, {
					method: 'PUT',
					headers: {
						Authorization: authHeader,
						'Content-Type': 'application/json',
						Accept: 'application/json'
					},
					body: JSON.stringify(couchDoc)
				});
				resStatus = fetchRes.status;
				resData = await fetchRes.json().catch(() => null);
			} else {
				console.error('Invalid COUCHDB_PUBLIC_WRITER_URL format');
			}
		} else {
			// Fallback if not configured yet, but should enforce via validate_doc_update
			const res = await adminRaw(
				`/${shelterDb}/${encodeURIComponent(couchDoc._id)}`,
				'PUT',
				couchDoc
			);
			resStatus = res.status;
			resData = res.data;
		}

		if (resStatus !== 201 && resStatus !== 200) {
			console.error('Failed to save to CouchDB', resData);
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
