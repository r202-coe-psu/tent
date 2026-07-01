import { json } from '@sveltejs/kit';
import { randomInt } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { donationPreDeclarationInputSchema } from '$lib/features/donations';
import { donationIpLimiter, donationPhoneLimiter } from '$lib/server/security/rate-limiter';
import { ReCaptchaProvider } from '$lib/server/security/captcha';
import { adminRaw } from '$lib/server/couch-admin';
import { sha256Hex } from '$lib/db/hash';

import type { Donation, DonationCampaign } from '$lib/features/operations';

const captchaProvider = new ReCaptchaProvider(env.SECRET_RECAPTCHA_KEY || 'dummy-secret');

// remaining ต่อ item = Σ(campaign.qty_target − บริจาคแล้ว); เก็บค่า ≤ 0 เพื่อตรวจ NEED_FULL
async function remainingNeeds(dbName: string): Promise<Map<string, number>> {
	const remaining = new Map<string, number>();
	const resCampaigns = await adminRaw(
		`/${dbName}/_all_docs?include_docs=true&startkey="donation_campaign:"&endkey="donation_campaign:\uFFF0"`,
		'GET'
	);
	if (resCampaigns.status >= 400) return remaining;
	const campaignRows = (resCampaigns.data as { rows?: { doc: DonationCampaign }[] })?.rows ?? [];
	const campaigns = campaignRows
		.map((r) => r.doc)
		.filter((c) => c && c.type === 'donation_campaign' && c.status === 'open');

	const resDonations = await adminRaw(
		`/${dbName}/_all_docs?include_docs=true&startkey="donation:"&endkey="donation:\uFFF0"`,
		'GET'
	);
	const donationRows = (resDonations.data as { rows?: { doc: Donation }[] })?.rows ?? [];
	const donations = donationRows.map((r) => r.doc).filter((d) => d && d.type === 'donation');

	for (const campaign of campaigns) {
		const covered = new Map<string, number>();
		for (const don of donations) {
			if (don.campaign_id !== campaign._id) continue;
			if (don.status === 'expired' || don.status === 'cancelled') continue;
			for (const it of don.items ?? []) {
				const itemId = it.item_id || resolveItemId(it.free_text);
				if (!itemId) continue;
				covered.set(itemId, (covered.get(itemId) ?? 0) + it.qty);
			}
		}
		for (const need of campaign.needs) {
			const rem = need.qty_target - (covered.get(need.item_id) ?? 0);
			remaining.set(need.item_id, (remaining.get(need.item_id) ?? 0) + rem);
		}
	}
	return remaining;
}

function resolveItemId(name: string): string | undefined {
	if (name.includes('ข้าว')) return 'item:rice';
	if (name.includes('น้ำ')) return 'item:water';
	if (name.includes('สบู่')) return 'item:soap';
	if (name.includes('ผ้าห่ม')) return 'item:blanket';
	return undefined;
}

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
		const dbName = `shelter_${parsed.data.shelter_code.toLowerCase()}`;
		const remaining = await remainingNeeds(dbName);
		for (const it of parsed.data.items) {
			const itemId = resolveItemId(it.free_text);
			if (itemId && remaining.has(itemId) && (remaining.get(itemId) ?? 0) <= 0) {
				return json({ success: false, error: 'NEED_FULL', item_id: itemId }, { status: 409 });
			}
		}

		// 4. Generate secure token and hash
		// Embed shelter_code in token so GET /donations/[token] knows which CouchDB database to query
		const trackingToken = `TX-${parsed.data.shelter_code.toUpperCase()}-${crypto.randomUUID().substring(0, 8).toUpperCase()}`;
		const bookingRef = 'DN-' + randomInt(100000, 1000000);
		const now = new Date().toISOString();

		const expiresAtDate = new Date();
		expiresAtDate.setHours(expiresAtDate.getHours() + 72);

		const phoneHash = await sha256Hex(phone);
		const trackingTokenHash = await sha256Hex(trackingToken);

		// 5. Save to CouchDB (Real database layer)
		const couchDoc = {
			_id: `donation:${trackingTokenHash}`,
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
			tracking_token_hash: trackingTokenHash, // store token hash
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
			if (!dev) {
				console.error('COUCHDB_PUBLIC_WRITER_URL is missing in production!');
				return json({ success: false, error: 'Server configuration error.' }, { status: 500 });
			}
			// Fallback in dev if not configured yet, but should enforce via validate_doc_update
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
