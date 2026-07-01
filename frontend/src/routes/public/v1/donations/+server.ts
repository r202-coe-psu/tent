import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { donationPreDeclarationInputSchema } from '$lib/features/donations';
import type { Donation, DonationCampaign } from '$lib/features/operations';
import { donationIpLimiter, donationPhoneLimiter } from '$lib/server/security/rate-limiter';
import { ReCaptchaProvider } from '$lib/server/security/captcha';
import { adminRaw } from '$lib/server/couch-admin';
import { sha256Hex } from '$lib/db/hash';
import { ulid } from '$lib/db/ulid';

const captchaProvider = new ReCaptchaProvider(env.SECRET_RECAPTCHA_KEY || 'dummy-secret');

// remaining ต่อ item = Σ(campaign.qty_target − บริจาคแล้ว); เก็บค่า ≤ 0 เพื่อตรวจ NEED_FULL
async function remainingNeeds(dbName: string): Promise<Map<string, number>> {
	const remaining = new Map<string, number>();
	const resCampaigns = await adminRaw(
		`/${dbName}/_all_docs?include_docs=true&startkey="donation_campaign:"&endkey="donation_campaign:￰"`,
		'GET'
	);
	if (resCampaigns.status >= 400) return remaining;
	const campaignRows = (resCampaigns.data as { rows?: { doc: DonationCampaign }[] })?.rows ?? [];
	const campaigns = campaignRows
		.map((r) => r.doc)
		.filter((c) => c && c.type === 'donation_campaign' && c.status === 'open');

	const resDonations = await adminRaw(
		`/${dbName}/_all_docs?include_docs=true&startkey="donation:"&endkey="donation:￰"`,
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
				if (!it.item_id) continue;
				covered.set(it.item_id, (covered.get(it.item_id) ?? 0) + it.qty);
			}
		}
		for (const need of campaign.needs) {
			const rem = need.qty_target - (covered.get(need.item_id) ?? 0);
			remaining.set(need.item_id, (remaining.get(need.item_id) ?? 0) + rem);
		}
	}
	return remaining;
}

function resolveItemId(name: string, given?: string): string | undefined {
	if (given) return given;
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

		// 3. CAPTCHA Check (Bypass if dummy secret or in development environment)
		if (!dev && env.SECRET_RECAPTCHA_KEY && env.SECRET_RECAPTCHA_KEY !== 'dummy-secret') {
			const isHuman = await captchaProvider.verifyToken(parsed.data.captchaToken, ip);
			if (!isHuman) {
				return json({ success: false, error: 'CAPTCHA verification failed.' }, { status: 403 });
			}
		}

		const dbName = `shelter_${parsed.data.shelter_code.toLowerCase()}`;

		// 4. เตรียม items (ใช้ item_id จาก card ก่อน, ไม่มีค่อยเดาจากชื่อ)
		const items = parsed.data.items_declared.map((item) => ({
			item_id: resolveItemId(item.item_name, item.item_id),
			free_text: item.item_name,
			category: item.category,
			qty: item.qty,
			unit: item.unit,
			condition: item.condition,
			note: item.note
		}));

		// 5. Atomic re-check (DN): ของที่รับครบแล้ว (needs_open ≤ 0) จองไม่ได้ → NEED_FULL
		const remaining = await remainingNeeds(dbName);
		for (const it of items) {
			if (it.item_id && remaining.has(it.item_id) && (remaining.get(it.item_id) ?? 0) <= 0) {
				return json({ success: false, error: 'NEED_FULL', item_id: it.item_id }, { status: 409 });
			}
		}

		// 6. Generate secure token and hash
		const trackingToken = 'TX-DON-' + crypto.randomUUID().substring(0, 8).toUpperCase();
		const trackingTokenHash = await sha256Hex(trackingToken);

		// 7. Save to CouchDB (donation doc schema_v 2 ลง shelter db — ตาม CLAUDE.md persistence → CouchDB)
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
				line_id: parsed.data.donor.line_id ?? null,
				email: parsed.data.donor.email ? parsed.data.donor.email : null
			},
			kind: 'items',
			items,
			campaign_id: null,
			status: 'declared',
			booking_ref: 'DN-' + Math.floor(100000 + Math.random() * 900000),
			tracking_token_hash: trackingTokenHash,
			declared_at: nowStr,
			received_at: null,
			expires_at: expiresAt,
			logistics: {
				delivery_method: parsed.data.logistics?.delivery_method ?? 'self_dropoff',
				vehicle: parsed.data.logistics?.vehicle ?? null,
				eta: parsed.data.logistics?.eta ?? null,
				courier_tracking_no: parsed.data.logistics?.courier_tracking_no ?? null,
				pickup_address: parsed.data.logistics?.pickup_address ?? null
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
			booking_ref: doc.booking_ref,
			as_of: new Date().toISOString()
		});
	} catch (e) {
		console.error(e);
		return json({ success: false, error: 'Internal Server Error' }, { status: 500 });
	}
};
