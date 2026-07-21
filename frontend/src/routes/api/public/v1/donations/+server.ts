import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { donationPreDeclarationInputSchema, computeNeeds } from '$lib/features/donations';
import type { PublicDonationDoc } from '$lib/features/donations';
import { donationIpLimiter, donationPhoneLimiter } from '$lib/server/security/rate-limiter';
import { ReCaptchaProvider } from '$lib/server/security/captcha';
import { adminRaw } from '$lib/server/couch-admin';
import { fetchDocs } from '$lib/server/donation-docs';

import type { DonationCampaign } from '$lib/features/operations';
import { qtyGt } from '$lib/utils/qty';

const captchaProvider = new ReCaptchaProvider(env.SECRET_RECAPTCHA_KEY || 'dummy-secret');

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

		// 3.1 Validate shelter_code — ต้องมีศูนย์นี้ใน registry และ status === 'open'
		// registry เก็บ shelter เป็น _id = shelter:{ulid} + field `code` → ต้อง scan by code
		// (ไม่ใช่ GET /registry/shelter:{code} ตรงๆ — _id ไม่ใช่ code)
		const shelterCode = parsed.data.shelter_code;
		const regRes = await adminRaw('/registry/_all_docs?include_docs=true', 'GET');
		if (regRes.status >= 400) {
			console.error('Registry lookup failed', regRes.data);
			return json({ success: false, error: 'Internal Server Error' }, { status: 500 });
		}
		const regRows =
			(regRes.data as { rows?: { id: string; doc?: { code?: string; status?: string } }[] })
				?.rows ?? [];
		const shelterDoc = regRows.find(
			(r) => r.id.startsWith('shelter:') && r.doc?.code === shelterCode
		)?.doc;
		if (!shelterDoc) {
			return json(
				{ success: false, error: 'SHELTER_NOT_FOUND', shelter_code: shelterCode },
				{ status: 404 }
			);
		}
		if (shelterDoc.status !== 'open') {
			return json(
				{ success: false, error: 'SHELTER_CLOSED', shelter_code: shelterCode },
				{ status: 409 }
			);
		}

		const dbName = `shelter_${shelterCode.toLowerCase()}`;

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

		// 3.5 Best-effort re-check needs_open vs ยอดที่ขอ → NEED_FULL (CR-005 DN-4)
		// หมายเหตุ: read→decide→write ยังไม่ atomic จริง (ไม่มี validate_doc_update/optimistic lock)
		// — atomicity เต็มรูปเป็นงาน T-02. ปฏิเสธเมื่อของเหลือน้อยกว่าที่ผู้บริจาคขอ (ไม่ใช่แค่ ≤ 0)
		// ผูก campaign เฉพาะ item_id ที่ส่งมาจากการ์ด needs เท่านั้น — ไม่เดา item_id จาก free_text
		// (เลิก substring heuristic ที่อาจ bind campaign ผิด); free-text ล้วน → ไม่นับต่อ campaign
		let resolvedCampaignId: string | null = null;
		for (const it of parsed.data.items) {
			const itemId = it.item_id;
			if (!itemId) continue;
			if (remaining.has(itemId) && qtyGt(it.qty, remaining.get(itemId) ?? '0')) {
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

		// 4. Persist via FastAPI → MongoDB donations buffer (inbound worker → CouchDB)
		const fastapiBase = env.PUBLIC_FASTAPI_PROXY || 'http://localhost:9000';
		const apiRes = await fetch(`${fastapiBase}/public/v1/donations`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				shelter_code: parsed.data.shelter_code,
				campaign_id: resolvedCampaignId,
				donor: parsed.data.donor,
				items: parsed.data.items,
				logistics: parsed.data.logistics
			})
		});

		if (!apiRes.ok) {
			const errBody = await apiRes.json().catch(() => ({}));
			return json(
				{
					success: false,
					...(typeof errBody === 'object' ? errBody : { error: 'Database save failed' })
				},
				{ status: apiRes.status }
			);
		}

		const created = (await apiRes.json()) as {
			tracking_token: string;
			booking_ref: string;
		};

		return json({
			success: true,
			trackingToken: created.tracking_token,
			bookingRef: created.booking_ref,
			as_of: new Date().toISOString()
		});
	} catch (e) {
		console.error(e);
		return json({ success: false, error: 'Internal Server Error' }, { status: 500 });
	}
};
