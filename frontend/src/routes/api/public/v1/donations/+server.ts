import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
	donationPreDeclarationInputSchema,
	computeNeeds,
	pickCampaignForItems,
	slotAvailabilityFor,
	slotModeForDelivery
} from '$lib/features/donations/server';
import type { PublicDonationDoc } from '$lib/features/donations';
import { donationIpLimiter, donationPhoneLimiter } from '$lib/server/security/rate-limiter';
import { ReCaptchaProvider } from '$lib/server/security/captcha';
import { verifyRecaptchaOrSkip } from '$lib/server/security/recaptcha-gate';
import { adminRaw } from '$lib/server/couch-admin';
import { fetchDocs } from '$lib/server/donation-docs';
import { fastapiBaseUrl, fastapiServiceHeaders, unwrapFastapiError } from '$lib/server/fastapi';

import type {
	DonationCampaign,
	DonationSlot,
	DonationSlotMode,
	StockLedger
} from '$lib/features/operations';

const captchaProvider = new ReCaptchaProvider(
	env.RECAPTCHA_PROJECT_ID || env.SECRET_RECAPTCHA_KEY || 'smart-shelter-508719'
);

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

		// 3. CAPTCHA Check (honors config:app.recaptcha_enabled)
		const captcha = await verifyRecaptchaOrSkip({
			token: parsed.data.captchaToken ?? '',
			ip,
			action: 'donate',
			provider: captchaProvider
		});
		if (!captcha.ok) {
			const message =
				captcha.error === 'SERVER_MISCONFIGURED'
					? 'Server configuration error.'
					: captcha.error === 'CAPTCHA_REQUIRED'
						? 'CAPTCHA token is required.'
						: 'CAPTCHA verification failed.';
			return json({ success: false, error: message }, { status: captcha.status });
		}

		// 3.1 shelter_code is validated by FastAPI against `public_shelters`
		// (SHELTER_NOT_FOUND 404 / SHELTER_CLOSED 409) — CR-017 §Decision A puts the
		// public plane on Mongo, so this route must not read the registry itself. The
		// scan that used to live here pulled all 8,444 registry docs (~6.3 MB) on every
		// donation just to read one shelter's status.
		const shelterCode = parsed.data.shelter_code;
		const dbName = `shelter_${shelterCode.toLowerCase()}`;

		// โหลด campaigns + donations + stock ครั้งเดียวแล้วใช้ซ้ำทุกการตรวจ
		const [campaigns, donations, stockLedgers] = await Promise.all([
			fetchDocs<DonationCampaign>(dbName, 'donation_campaign:').then((docs) =>
				docs.filter((c) => c && c.type === 'donation_campaign' && c.status === 'open')
			),
			fetchDocs<PublicDonationDoc>(dbName, 'donation:').then((docs) =>
				docs.filter((d) => d && d.type === 'donation')
			),
			// T-22 ปิดรับเมื่อ on-hand + reserved ≥ target — ถ้าไม่นับคลัง หน้าเว็บจะรับ
			// ของที่ศูนย์ปิดรับไปแล้ว (ตรงกับสูตรของ deriveNeedAvailability ฝั่งหลังบ้าน)
			fetchDocs<StockLedger>(dbName, 'stock_ledger:').then((docs) =>
				docs.filter((l) => l && l.type === 'stock_ledger')
			)
		]);

		const { campaignRemaining } = computeNeeds(campaigns, donations, stockLedgers);

		// 3.5 Best-effort re-check needs_open vs ยอดที่ขอ → NEED_FULL (CR-005 DN-4)
		// หมายเหตุ: read→decide→write ยังไม่ atomic จริง (ไม่มี validate_doc_update/optimistic lock)
		// — atomicity เต็มรูปเป็นงาน T-02; ชั้นที่กันจริงคือ donation_need_counter (CR-047)
		// เลือก campaign ที่รับไหวจริง ไม่ใช่ตัวแรกที่บังเอิญขอ item นี้ — ยอดรวมข้ามแคมเปญ
		// จองในใบเดียวไม่ได้ เพราะ donation หนึ่งใบผูก campaign_id ได้ตัวเดียว
		const pick = pickCampaignForItems(campaignRemaining, parsed.data.items);
		if (!pick.ok) {
			return json({ success: false, error: 'NEED_FULL', item_id: pick.itemId }, { status: 409 });
		}
		const resolvedCampaignId = pick.campaignId;

		// 3.6 Re-check the chosen window: full or closed → SLOT_FULL.
		// Not atomic on its own — two submits can both read the last place free before
		// either syncs back into CouchDB. A capped window therefore also goes to FastAPI
		// as `slot_hold`, whose Mongo counter makes the final SLOT_FULL call.
		const slotMode = parsed.data.logistics
			? slotModeForDelivery(parsed.data.logistics.delivery_method)
			: null;
		const requested = parsed.data.logistics?.slot;
		// Set when the window has a ceiling: FastAPI takes the place on its atomic
		// counter, which is what actually refuses the second of two simultaneous bookings.
		let slotHold:
			| { mode: DonationSlotMode; date: string; from: string; capacity: number; booked: number }
			| undefined;
		// A truck trip only exists where the shelter published one, so a pickup with no
		// window — or a window with no doc behind it — is refused rather than waved
		// through. A drop-off with no doc is fine: it is one of the standard hours.
		if (slotMode === 'pickup' && !requested) {
			return json({ success: false, error: 'SLOT_REQUIRED' }, { status: 422 });
		}
		if (requested && slotMode) {
			const { date, from, to } = requested;
			const lookup = async (id: string) => adminRaw(`/${dbName}/${encodeURIComponent(id)}`, 'GET');
			let slotRes = await lookup(`donation_slot:${slotMode}:${date}:${from}`);
			// A drop-off window written before the queue split has no mode in its id
			// (`donation_slot:{date}:{from}`) and still reads as drop-off (FR-DS-9) — the
			// availability grid shows it, so the re-check has to find it too.
			if (slotRes.status === 404 && slotMode === 'dropoff') {
				slotRes = await lookup(`donation_slot:${date}:${from}`);
			}

			if (slotRes.status === 200) {
				// Same verdict the wizard's grid showed (GET .../donations/slots) — one
				// function, so a window cannot read open there and full here.
				const slotDoc = slotRes.data as DonationSlot;
				// `_id` is deterministic per date + start time (schema.md §2.13), so the
				// requested window IS this doc's identity — count against that rather than
				// re-reading fields off the doc.
				const availability = slotAvailabilityFor(
					{ ...slotDoc, mode: slotMode, date, from, to },
					donations
				);
				if (availability.status !== 'available') {
					return json({ success: false, error: 'SLOT_FULL' }, { status: 409 });
				}
				if (availability.capacity !== null) {
					slotHold = {
						mode: slotMode,
						date,
						from,
						capacity: availability.capacity,
						booked: availability.booked
					};
				}
			} else if (slotRes.status === 404) {
				if (slotMode === 'pickup') {
					return json({ success: false, error: 'SLOT_UNAVAILABLE' }, { status: 409 });
				}
			} else {
				// Could not tell — fail closed rather than book a window we could not check.
				return json({ success: false, error: 'SLOTS_UNAVAILABLE' }, { status: 503 });
			}
		}

		// 4. Persist via FastAPI → MongoDB donations buffer (inbound worker → CouchDB)
		const apiRes = await fetch(`${fastapiBaseUrl()}/public/v1/donations`, {
			method: 'POST',
			headers: fastapiServiceHeaders({ 'Content-Type': 'application/json' }),
			body: JSON.stringify({
				shelter_code: parsed.data.shelter_code,
				campaign_id: resolvedCampaignId,
				donor: parsed.data.donor,
				items: parsed.data.items,
				logistics: parsed.data.logistics,
				slot_hold: slotHold
			})
		});

		if (!apiRes.ok) {
			const errBody = await apiRes.json().catch(() => ({}));
			return json(
				{ success: false, ...unwrapFastapiError(errBody, 'Database save failed') },
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
