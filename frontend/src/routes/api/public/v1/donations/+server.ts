import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
	donationPreDeclarationInputSchema,
	computeNeeds,
	filterCampaignsByCards,
	pickCampaignForItems,
	DEFAULT_SLOT_WINDOWS,
	slotAvailabilityFor,
	slotModeForDelivery,
	withCampaignLinePoints,
	rejectDonationPhotoDocs,
	rejectDonationPhotoIds,
	type DonationPhotoErrorCode
} from '$lib/features/donations/server';
import type { PublicDonationDoc } from '$lib/features/donations';
import { ReCaptchaProvider } from '$lib/server/security/captcha';
import { verifyRecaptchaOrSkip } from '$lib/server/security/recaptcha-gate';
import { bangkokToday } from '$lib/utils/date';
import { adminRaw } from '$lib/server/couch-admin';
import {
	fetchDocs,
	fetchDocsStrict,
	readDonationPhotos,
	CouchReadError
} from '$lib/server/donation-docs';
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

		const ip = getClientAddress();

		// 2. CAPTCHA Check (honors config:app.recaptcha_enabled)
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

		// 3.2 Donor photos (CR-175 FR-10): the count first, then each doc by `_id`.
		const photos = parsed.data.photos ?? [];
		let photoError: DonationPhotoErrorCode | null = rejectDonationPhotoIds(photos);
		if (!photoError && photos.length > 0) {
			try {
				photoError = rejectDonationPhotoDocs(await readDonationPhotos(dbName, photos));
			} catch (e) {
				if (!(e instanceof CouchReadError)) throw e;
				console.error(e);
				return json({ success: false, error: 'PHOTOS_UNAVAILABLE' }, { status: 503 });
			}
		}
		if (photoError) {
			return json({ success: false, error: photoError, error_code: photoError }, { status: 422 });
		}

		// โหลด campaigns + donations + stock ครั้งเดียวแล้วใช้ซ้ำทุกการตรวจ
		// `donation:` is read strictly: it feeds both the need-remaining and the slot
		// count, so an outage there must refuse the booking (503) instead of reading as
		// "nothing booked yet" and letting a full window or need be overbooked.
		const [campaigns, donations, stockLedgers] = await Promise.all([
			// A campaign staff hid from the site takes no public booking (owner 2026-10-31, CR-206
			// A2 D-AP-18): the worker leaves it off the board, so counting it here would book
			// against a quota no card shows (FR-AP-31).
			fetchDocs<DonationCampaign>(dbName, 'donation_campaign:').then((docs) =>
				docs.filter(
					(c) =>
						c &&
						c.type === 'donation_campaign' &&
						c.status === 'open' &&
						c.visible_on_home !== false
				)
			),
			fetchDocsStrict<PublicDonationDoc>(dbName, 'donation:').then((docs) =>
				docs.filter((d) => d && d.type === 'donation')
			),
			// T-22 ปิดรับเมื่อ on-hand + reserved ≥ target — ถ้าไม่นับคลัง หน้าเว็บจะรับ
			// ของที่ศูนย์ปิดรับไปแล้ว (ตรงกับสูตรของ deriveNeedAvailability ฝั่งหลังบ้าน)
			fetchDocs<StockLedger>(dbName, 'stock_ledger:').then((docs) =>
				docs.filter((l) => l && l.type === 'stock_ledger')
			)
		]);

		// FR-AP-7b: only campaigns matching the card(s) the donor pressed may take the booking;
		// never fall back to another point's campaign (D-AP-17).
		const cardCampaigns = filterCampaignsByCards(campaigns, parsed.data.items);
		const { campaignRemaining } = computeNeeds(cardCampaigns, donations, stockLedgers);

		// 3.5 Best-effort re-check needs_open vs ยอดที่ขอ → NEED_FULL (CR-005 DN-4)
		// หมายเหตุ: read→decide→write ยังไม่ atomic จริง (ไม่มี validate_doc_update/optimistic lock)
		// — atomicity เต็มรูปเป็นงาน T-02; ชั้นที่กันจริงคือ donation_need_counter (CR-047)
		// เลือก campaign ที่รับไหวจริง ไม่ใช่ตัวแรกที่บังเอิญขอ item นี้ — ยอดรวมข้ามแคมเปญ
		// จองในใบเดียวไม่ได้ เพราะ donation หนึ่งใบผูก campaign_id ได้ตัวเดียว
		// A pressed card no open campaign carries any more reads as full, not as "untracked".
		const orphanCard =
			cardCampaigns.length === 0
				? parsed.data.items.find((it) => it.item_id && it.need_drop_off_point_id !== undefined)
				: undefined;
		if (orphanCard) {
			return json(
				{ success: false, error: 'NEED_FULL', item_id: orphanCard.item_id },
				{ status: 409 }
			);
		}
		const pick = pickCampaignForItems(campaignRemaining, parsed.data.items);
		if (!pick.ok) {
			return json({ success: false, error: 'NEED_FULL', item_id: pick.itemId }, { status: 409 });
		}
		const resolvedCampaignId = pick.campaignId;
		const pickedCampaign = cardCampaigns.find((c) => c._id === resolvedCampaignId) ?? null;

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
		// through. A drop-off with no doc is only fine when it is one of the standard
		// windows (FR-DS-12); any other hour needs a shelter-published override doc.
		if (slotMode === 'pickup' && !requested) {
			return json({ success: false, error: 'SLOT_REQUIRED' }, { status: 422 });
		}
		if (requested && slotMode) {
			const { date, from, to } = requested;
			// A date that is already past cannot be booked. Compared on the
			// shelter's calendar (Asia/Bangkok), not UTC, or the early-morning donor
			// sees "yesterday" as still open.
			if (date < bangkokToday()) {
				return json({ success: false, error: 'SLOT_UNAVAILABLE' }, { status: 409 });
			}
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
				// `_id` is deterministic per mode + date + start time (schema.md §2.13), so the
				// requested date and start ARE this doc's identity. The end is not part of
				// it: a donor who sends a different `to` is asking for a window the shelter
				// never published, and must not borrow this doc's capacity for it.
				if (slotDoc.to !== to) {
					return json({ success: false, error: 'SLOT_UNAVAILABLE' }, { status: 409 });
				}
				const availability = slotAvailabilityFor(
					{ ...slotDoc, mode: slotMode, date, from },
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
				if (
					slotMode === 'pickup' ||
					!DEFAULT_SLOT_WINDOWS.some((w) => w.from === from && w.to === to)
				) {
					return json({ success: false, error: 'SLOT_UNAVAILABLE' }, { status: 409 });
				}
			} else {
				// Could not tell — fail closed rather than book a window we could not check.
				return json({ success: false, error: 'SLOTS_UNAVAILABLE' }, { status: 503 });
			}
		}

		// 3.7 Drop-off point per line, set by staff (FR-AP-8): a campaign line takes its need's
		// point from the campaign picked above. Not checked against the registry (D-AP-10).
		// `need_drop_off_point_id` only picked the campaign (FR-AP-7a) — undefined drops it from the JSON.
		const items = withCampaignLinePoints(
			parsed.data.items,
			pickedCampaign,
			parsed.data.logistics.delivery_method
		).map((line) => ({ ...line, need_drop_off_point_id: undefined }));

		// 4. Persist via FastAPI → MongoDB donations buffer (inbound worker → CouchDB)
		const apiRes = await fetch(`${fastapiBaseUrl()}/public/v1/donations`, {
			method: 'POST',
			headers: fastapiServiceHeaders({ 'Content-Type': 'application/json' }),
			body: JSON.stringify({
				shelter_code: parsed.data.shelter_code,
				campaign_id: resolvedCampaignId,
				donor: parsed.data.donor,
				items,
				logistics: parsed.data.logistics,
				slot_hold: slotHold,
				...(photos.length > 0 ? { photos } : {})
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
			status?: string;
			items?: { drop_off_point_id: string | null; review_status: string }[];
		};

		return json({
			success: true,
			trackingToken: created.tracking_token,
			bookingRef: created.booking_ref,
			// CR-174 FR-15 — `verifying` when every line is a campaign line: the ticket shows the QR.
			status: created.status ?? 'pending_review',
			// FR-AP-8a — each line's point and review, for the ticket to group by.
			items: created.items ?? [],
			as_of: new Date().toISOString()
		});
	} catch (e) {
		if (e instanceof CouchReadError) {
			console.error(e);
			return json({ success: false, error: 'SLOTS_UNAVAILABLE' }, { status: 503 });
		}
		console.error(e);
		return json({ success: false, error: 'Internal Server Error' }, { status: 500 });
	}
};
