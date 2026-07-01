import { json } from '@sveltejs/kit';
import { randomInt } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { donationPreDeclarationInputSchema } from '$lib/features/donations';
import type { PublicDonationDoc } from '$lib/features/donations';
import { donationIpLimiter, donationPhoneLimiter } from '$lib/server/security/rate-limiter';
import { ReCaptchaProvider } from '$lib/server/security/captcha';
import { adminRaw } from '$lib/server/couch-admin';
import { sha256Hex } from '$lib/db/hash';
import { ulid } from '$lib/db/ulid';

import type { Donation, DonationCampaign } from '$lib/features/operations';

const captchaProvider = new ReCaptchaProvider(env.SECRET_RECAPTCHA_KEY || 'dummy-secret');

// ดึงเอกสารทั้งหมดของ type หนึ่งจาก shelter db (ใช้ pattern _all_docs เดิมของโปรเจกต์ — ไม่มี view)
async function fetchDocs<T>(dbName: string, prefix: string): Promise<T[]> {
	const res = await adminRaw(
		`/${dbName}/_all_docs?include_docs=true&startkey="${prefix}"&endkey="${prefix}￰"`,
		'GET'
	);
	if (res.status >= 400) return [];
	const rows = (res.data as { rows?: { doc: T }[] })?.rows ?? [];
	return rows.map((r) => r.doc).filter(Boolean);
}

// คำนวณความต้องการคงเหลือ + map item → campaign จาก campaign/donations ที่โหลดมาแล้ว (schema.md §2.4)
function computeNeeds(campaigns: DonationCampaign[], donations: Donation[]) {
	const remaining = new Map<string, number>(); // item_id → needs_open (เก็บค่า ≤ 0 เพื่อตรวจ NEED_FULL)
	const itemCampaign = new Map<string, string>(); // item_id → campaign_id (open campaign แรกที่ต้องการ item นี้)

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
			if (!itemCampaign.has(need.item_id)) itemCampaign.set(need.item_id, campaign._id);
		}
	}
	return { remaining, itemCampaign };
}

// fallback map สำหรับของที่ผู้บริจาคพิมพ์เอง (ไม่มี item_id จากการ์ด)
function resolveItemId(name: string | undefined): string | undefined {
	if (!name) return undefined;
	if (name.includes('ข้าว')) return 'item:rice';
	if (name.includes('น้ำ')) return 'item:water';
	if (name.includes('สบู่')) return 'item:soap';
	if (name.includes('ผ้าห่ม')) return 'item:blanket';
	return undefined;
}

export const POST = async ({ request, getClientAddress }) => {
	try {
		const payload = await request.json();

		// 1. Validate schema (logistics req เมื่อ channel=public — บังคับใน Zod แล้ว)
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

		const dbName = `shelter_${parsed.data.shelter_code.toLowerCase()}`;

		// โหลด campaigns + donations ครั้งเดียวแล้วใช้ซ้ำทุกการตรวจ (needs / booking_ref / slot)
		const [campaigns, donations] = await Promise.all([
			fetchDocs<DonationCampaign>(dbName, 'donation_campaign:').then((docs) =>
				docs.filter((c) => c && c.type === 'donation_campaign' && c.status === 'open')
			),
			fetchDocs<PublicDonationDoc>(dbName, 'donation:').then((docs) =>
				docs.filter((d) => d && d.type === 'donation')
			)
		]);

		const { remaining, itemCampaign } = computeNeeds(campaigns, donations);

		// 3.5 Atomic re-check needs_open ≤ 0 → NEED_FULL (CR-005 DN-4)
		let resolvedCampaignId: string | null = null;
		for (const it of parsed.data.items) {
			const itemId = it.item_id || resolveItemId(it.free_text);
			if (!itemId) continue;
			if (remaining.has(itemId) && (remaining.get(itemId) ?? 0) <= 0) {
				return json({ success: false, error: 'NEED_FULL', item_id: itemId }, { status: 409 });
			}
			// ผูก donation เข้ากับ campaign ที่ต้องการ item นี้ เพื่อให้ needs_open ลดลงตามจริง
			if (!resolvedCampaignId && itemCampaign.has(itemId)) {
				resolvedCampaignId = itemCampaign.get(itemId) ?? null;
			}
		}

		// 3.6 Atomic re-check slot เต็ม/closed → SLOT_FULL
		if (parsed.data.logistics?.slot) {
			const { date, from } = parsed.data.logistics.slot;
			const slotId = `donation_slot:${date}:${from}`;
			const slotRes = await adminRaw(`/${dbName}/${encodeURIComponent(slotId)}`, 'GET');

			if (slotRes.status === 200) {
				const slotDoc = slotRes.data as { capacity: number; status: string };
				if (slotDoc.status === 'closed') {
					return json({ success: false, error: 'SLOT_FULL' }, { status: 409 });
				}
				const bookedCount = donations.filter(
					(d) =>
						(d.status === 'declared' || d.status === 'received') &&
						d.logistics?.slot?.date === date &&
						d.logistics?.slot?.from === from
				).length;
				if (bookedCount >= slotDoc.capacity) {
					return json({ success: false, error: 'SLOT_FULL' }, { status: 409 });
				}
			}
		}

		// 4. Generate secure token + unique booking_ref + ulid id
		// Embed shelter_code in token so GET /donations/[token] knows which CouchDB database to query
		const trackingToken = `TX-${parsed.data.shelter_code.toUpperCase()}-${crypto.randomUUID().substring(0, 8).toUpperCase()}`;
		const trackingTokenHash = await sha256Hex(trackingToken);

		// booking_ref ต้อง unique (schema.md §2.3) — สุ่มแล้วเลี่ยงชนกับที่มีอยู่
		const existingRefs = new Set(donations.map((d) => d.booking_ref).filter(Boolean) as string[]);
		let bookingRef = 'DN-' + randomInt(100000, 1000000);
		while (existingRefs.has(bookingRef)) {
			bookingRef = 'DN-' + randomInt(100000, 1000000);
		}

		const now = new Date().toISOString();
		const expiresAtDate = new Date();
		expiresAtDate.setHours(expiresAtDate.getHours() + 72);
		const phoneHash = await sha256Hex(phone);

		// 5. Save to CouchDB — _id = donation:{ulid} (schema.md §2.3), lookup via tracking_token_hash
		const couchDoc = {
			_id: `donation:${ulid()}`,
			type: 'donation',
			schema_v: 2,
			channel: 'public',
			shelter_code: parsed.data.shelter_code,
			campaign_id: resolvedCampaignId,
			created_at: now,
			updated_at: now,
			declared_at: now,
			expires_at: expiresAtDate.toISOString(),
			created_by: 'public',
			booking_ref: bookingRef,
			tracking_token_hash: trackingTokenHash,
			kind: 'items',
			donor: {
				name: parsed.data.donor.name,
				phone, // เก็บเบอร์จริงใน CouchDB เพื่อให้เจ้าหน้าที่ติดต่อได้ (ไม่ echo สู่ public)
				phone_hash: phoneHash,
				line_id: parsed.data.donor.line_id,
				email: parsed.data.donor.email
			},
			items: parsed.data.items.map((i) => ({
				item_id: i.item_id,
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

				const fetchRes = await fetch(`${base}/${dbName}/${encodeURIComponent(couchDoc._id)}`, {
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
			const res = await adminRaw(`/${dbName}/${encodeURIComponent(couchDoc._id)}`, 'PUT', couchDoc);
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
