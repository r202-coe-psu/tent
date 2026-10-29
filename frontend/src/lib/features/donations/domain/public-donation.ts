import { z } from 'zod';
import type {
	Donation,
	DonationCloseReason,
	DonationPointReceipt,
	DonationStatus,
	Donor
} from '$lib/features/operations';
import { qtyGt, qtyStrCoerceNonNegativeSchema } from '$lib/utils/qty';
import {
	donationRejectReasonCodeSchema,
	rejectNoteSchema,
	requireNoteForOther,
	type DonationRejectReasonCode
} from './reject-reason';

export interface PublicDonor extends Donor {
	line_id?: string;
	email?: string;
}

export interface PublicDonationDoc extends Omit<Donation, 'donor'> {
	donor: PublicDonor;
	booking_ref?: string;
	logistics?: {
		delivery_method: 'self_dropoff' | 'parcel' | 'shelter_pickup';
		vehicle?: 'motorcycle' | 'car' | 'pickup' | 'truck';
		slot?: { date: string; from: string; to: string };
		eta?: string;
		courier_tracking_no?: string | null;
		pickup_address?: string;
	};
	received_summary?: {
		total_items: number;
		received_at: string;
		remarks?: string;
		closed_by?: string;
		closed_reason?: DonationCloseReason;
		shortfalls?: Array<{
			item_id?: string;
			item_name?: string;
			declared?: string;
			counted?: string;
			short?: string;
		}>;
		items?: Array<{
			item_id?: string;
			free_text?: string;
			qty: string;
			unit?: string;
			rejected?: boolean;
			reject_reason?: string;
			reject_reason_code?: DonationRejectReasonCode;
		}>;
	};
	reject_reason?: string | null;
	reject_reason_code?: DonationRejectReasonCode | null;
	items_declared?: Array<{
		item_id?: string;
		free_text?: string;
		category?: string;
		qty: string;
		unit: string;
		condition?: string;
		note?: string;
	}>;
	/**
	 * Append-only log of donor edits to `items` (schema.md §2.3, CR-080). Snapshots of
	 * the whole basket before and after, not diffs — staff reading the booking before
	 * accepting goods need to see what it used to be without reassembling it.
	 */
	revisions?: DonationRevision[];
}

export interface DonationRevision {
	at: string;
	by: 'donor' | 'staff';
	items_before: Array<{ item_id?: string; free_text?: string; qty: string; unit: string }>;
	items_after: Array<{ item_id?: string; free_text?: string; qty: string; unit: string }>;
}

/**
 * Redacted projection of a donation for the authorized back-office scan station.
 * Only the fields the scan UI needs — never the raw CouchDB doc (`_rev`,
 * `tracking_token_hash`, `phone_hash`, timestamps, …). Full donor `phone` is
 * intentionally included (authorized warehouse staff need it to contact donors).
 */
export interface ScanDonationView {
	/** `_rev` the screen was loaded with — sent back as `expected_rev` (CR-174 FR-25). */
	rev?: string;
	booking_ref?: string;
	shelter_code: string;
	status: string;
	donor: { name: string; phone: string | null; email?: string | null };
	items: Array<{
		item_id?: string;
		free_text?: string;
		qty: string;
		unit: string;
		/** The donor's note on the line — shown to staff as "คำชี้แจงจากผู้บริจาค". */
		note?: string;
		/** A line refused at review arrives already turned away (CR-174 AC-3). */
		review_status?: 'approved' | 'pending' | 'rejected';
		review_reason_code?: DonationRejectReasonCode | null;
		/** What the donor was told at review — kept as is through the counter. */
		review_reason?: string | null;
		/** The point the donor takes this line to (CR-206 FR-MP-1); `null` = any point. */
		drop_off_point_id?: string | null;
	}>;
	/** What each point already recorded (CR-206 FR-MP-19) — no ledger or audit ids. */
	point_receipts?: Array<
		Pick<DonationPointReceipt, 'point_id' | 'line_nos' | 'received_at' | 'received_by'>
	>;
	logistics?: PublicDonationDoc['logistics'];
	/** Donor photos, `image:{ulid}` in `shelter_code`'s DB (CR-175 donor photos FR-12). */
	photos?: string[];
}

/**
 * Back-office scan station — receive-donation mutation body (status locked to `received`).
 *
 * `items` here are what staff physically COUNTED, which may differ from what the
 * donor declared. Lines carrying an `item_id` mint a `stock_ledger` entry; free-text
 * lines stay on the donation only (they are not in the catalog, so they cannot be
 * counted as stock — schema.md §2.1 requires a real `item_id` + matching `unit`).
 */
export const receiveDonationInputSchema = z
	.object({
		status: z.literal('received'),
		/** `_rev` of the booking the screen was loaded with (CR-174 FR-25). */
		expected_rev: z.string().min(1),
		/**
		 * The recorder's drop-off point (CR-206 FR-MP-22). `null` only once the shelter has no
		 * drop-off point left (FR-MP-18b) — checked by the route against the shelter doc.
		 */
		point_id: z.string().trim().min(1).nullable().optional(),
		/** Positions in `items` this receipt records, received or turned away (FR-MP-22). */
		line_nos: z.array(z.number().int().min(0)).optional(),
		/** Optional note from the receiving staff — lands on `received_summary.remarks`. */
		remarks: z.string().trim().max(500).optional(),
		items: z
			.array(
				z.object({
					item_id: z.string().optional(),
					free_text: z.string().optional(),
					// > 0 unless the line is rejected — checked below with the line's flag.
					qty: qtyStrCoerceNonNegativeSchema,
					unit: z.string().min(1),
					/**
					 * Staff turned this line away (CR-172 FR-9, FR-10): it needs a reason, keys no
					 * ledger row and gets no lot. The whole line — no partial quantity.
					 */
					rejected: z.boolean().optional(),
					reject_reason_code: donationRejectReasonCodeSchema.optional(),
					reject_note: rejectNoteSchema.optional(),
					/**
					 * `lot_no` is NOT accepted from the client — the server mints it at
					 * receive time so the per-day sequence stays under one authority
					 * (CR-088). Zod strips it if a caller sends one anyway.
					 */
					lot: z
						.object({
							expiry: z.string().optional(),
							note: z.string().trim().optional(),
							storage_zone: z.string().trim().max(100).optional(),
							// → shelter sub_storage[].id (draft-shelter-storage-points); kept, not stripped
							storage_point_id: z.string().trim().min(1).optional()
						})
						.optional()
				})
			)
			.optional()
	})
	.superRefine((value, ctx) => {
		// FR-MP-22a — a point receipt names both its point and its lines, and only real lines once.
		const hasPoint = value.point_id !== undefined;
		const lineNos = value.line_nos;
		if (hasPoint !== (lineNos !== undefined)) {
			ctx.addIssue({
				code: 'custom',
				path: [hasPoint ? 'line_nos' : 'point_id'],
				message: 'point_id and line_nos are sent together'
			});
		}
		if (lineNos !== undefined) {
			const lineCount = value.items?.length ?? 0;
			if (lineNos.length === 0) {
				ctx.addIssue({ code: 'custom', path: ['line_nos'], message: 'line_nos is empty' });
			}
			if (new Set(lineNos).size !== lineNos.length) {
				ctx.addIssue({ code: 'custom', path: ['line_nos'], message: 'line_nos repeats a line' });
			}
			if (lineNos.some((lineNo) => lineNo >= lineCount)) {
				ctx.addIssue({
					code: 'custom',
					path: ['line_nos'],
					message: 'line_nos names a line outside items'
				});
			}
		}
		// A point receipt records only its own lines; the rest ride along unchecked (FR-MP-22).
		const recordedNow = lineNos ? new Set(lineNos) : null;
		for (const [index, line] of (value.items ?? []).entries()) {
			if (recordedNow && !recordedNow.has(index)) continue;
			if (line.rejected) {
				if (!line.reject_reason_code) {
					ctx.addIssue({
						code: 'custom',
						path: ['items', index, 'reject_reason_code'],
						message: 'รายการที่ไม่รับต้องระบุเหตุผล'
					});
				}
				requireNoteForOther({ reason_code: line.reject_reason_code, note: line.reject_note }, ctx, [
					'items',
					index,
					'reject_note'
				]);
			} else if (!qtyGt(line.qty, 0)) {
				ctx.addIssue({
					code: 'custom',
					path: ['items', index, 'qty'],
					message: 'จำนวนที่รับต้องมากกว่า 0'
				});
			}
		}
	});
export type ReceiveDonationInput = z.infer<typeof receiveDonationInputSchema>;

/**
 * Statuses in which a donor may still cancel their own booking or add a courier number
 * through the public token routes (T-21 DoD — "Donor แก้/ยกเลิกการจองของตนผ่าน token ได้").
 * Editing the lines is narrower — `donationItemEditGate` (CR-196).
 *
 * Only a reservation still awaiting drop-off qualifies. Once goods arrive the count
 * belongs to staff and the stock ledger, and `cancelled`/`expired` have already
 * released their quota — reopening either would desync the counter.
 *
 * `pending_review` is in (decision D-1): since CR-052 every public booking opens
 * there rather than at `declared`, so leaving it out would take the donor's own
 * edit/cancel away from every booking the wizard creates. `verifying` is in since
 * CR-174 (FR-20..FR-23): a booking of campaign lines has its QR from the start, and the
 * donor must still be able to cancel (a flood can keep them from coming), fix the
 * basket or add the courier number. An edit that adds a line needing review sends the
 * booking back to `pending_review`.
 *
 * Mirrored by `DONOR_EDITABLE_STATUSES` in the FastAPI donations use case; the two
 * gate the same routes and have to move together.
 */
const DONOR_EDITABLE_STATUSES = new Set<DonationStatus>([
	'declared',
	'pending_review',
	'verifying'
]);

export function isDonorEditable(status: DonationStatus): boolean {
	return DONOR_EDITABLE_STATUSES.has(status);
}

/**
 * What a donor's item edit meets (CR-196 FR-LK-4): `editable`, `already_reviewed` (the QR
 * is out, the booking was refused, or a line was decided — by the campaign rule or by
 * staff), or `closed` (the booking is past drop-off). Mirrors `item_edit_gate` in the
 * FastAPI donations review module.
 */
export type DonationItemEditGate = 'editable' | 'already_reviewed' | 'closed';

const ITEM_EDIT_BY_STATUS: Partial<Record<string, DonationItemEditGate>> = {
	declared: 'editable',
	pending_review: 'editable',
	verifying: 'already_reviewed',
	rejected: 'already_reviewed'
};

/**
 * Once anything on a booking was decided its lines are fixed: an edit could otherwise
 * re-pair a refused line with an approved one and come out approved (review #783 H1).
 * The donor cancels and books again, or tells staff at drop-off.
 */
export function donationItemEditGate(
	status: string,
	items: readonly { review_status?: string | null }[]
): DonationItemEditGate {
	const gate = ITEM_EDIT_BY_STATUS[status] ?? 'closed';
	if (
		gate === 'editable' &&
		items.some((item) => item.review_status === 'approved' || item.review_status === 'rejected')
	) {
		return 'already_reviewed';
	}
	return gate;
}

const PUBLIC_DONATION_ERROR_MESSAGES: Record<string, string> = {
	NEED_FULL: 'รายการนี้รับบริจาคครบแล้ว กรุณาเลือกรายการอื่น',
	SLOT_FULL: 'คิวจัดส่งเต็มแล้ว กรุณาเลือกช่วงเวลาอื่น',
	SLOT_REQUIRED: 'กรุณาเลือกรอบรถที่ศูนย์เปิดให้ไปรับของ',
	SLOT_UNAVAILABLE: 'ช่วงเวลาที่เลือกไม่เปิดรับแล้ว กรุณาเลือกช่วงเวลาอื่น',
	SLOTS_UNAVAILABLE: 'ตรวจสอบคิวไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
	SHELTER_NOT_FOUND: 'ไม่พบศูนย์พักพิงที่เลือก',
	SHELTER_CLOSED: 'ศูนย์พักพิงนี้ปิดรับบริจาคชั่วคราว',
	RATE_LIMITED: 'คุณส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
	// CR-175 donor photos (FR-10)
	PHOTO_LIMIT_EXCEEDED: 'แนบรูปได้ไม่เกิน 30 รูปต่อใบ',
	PHOTO_NOT_FOUND: 'ไม่พบรูปที่แนบ กรุณาลบรูปนั้นแล้วแนบใหม่',
	PHOTO_INVALID: 'รูปที่แนบใช้กับการบริจาคไม่ได้ กรุณาลบรูปนั้นแล้วแนบใหม่',
	PHOTO_ALREADY_USED: 'รูปที่แนบถูกใช้กับใบจองอื่นแล้ว กรุณาลบรูปนั้นแล้วแนบใหม่',
	PHOTOS_TOO_LARGE: 'รูปที่แนบรวมกันเกิน 10 MB กรุณาลบบางรูป',
	PHOTOS_UNAVAILABLE: 'ตรวจสอบรูปที่แนบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
};

/** Map public donation API error codes to donor-facing Thai copy. */
export function publicDonationErrorMessage(code: string): string {
	return PUBLIC_DONATION_ERROR_MESSAGES[code] ?? 'ไม่สามารถจองคิวบริจาคได้ กรุณาลองใหม่อีกครั้ง';
}

/**
 * One line of the public donate wizard's item list, as far as the unit rule cares
 * (R-15.4). The wizard keeps a display label in `unit` because the donor sees it
 * ("กก.", "ก้อน") and may type their own for a walk-in donation; `unit_code` is the
 * catalog `item_master.base_unit` and is only set when the line came from a need
 * card, together with `item_id`.
 */
export type DonationUnitSource = {
	unit_code?: string;
	unit?: string;
};

/**
 * The `unit` to put in a `POST /public/v1/donations` item.
 *
 * `schema.md §2.1` requires `items[].unit` to equal `item_master.base_unit` whenever
 * `item_id` is set, and the intake counter enforces it (422 `CATALOG_MISMATCH`) —
 * sending the Thai label instead made every booking from a need card impossible to
 * receive into stock, with no way for warehouse staff to fix it (R-15.4).
 *
 * So the catalog code always wins when present; the donor-visible label is only a
 * fallback for free-text lines, which carry no `item_id` to be checked against.
 */
export function donationPayloadUnit(item: DonationUnitSource, fallback: string): string {
	return item.unit_code?.trim() || item.unit?.trim() || fallback;
}

/** One donor line as the wizard holds it; `needQty` is a hint and never leaves the form. */
export type DonationPayloadLine = DonationUnitSource & {
	item_id?: string;
	name: string;
	category?: string;
	amount: number;
	condition?: string;
	remark?: string;
	/** The line's drop-off point (CR-206 FR-MP-1); left out of the payload when undefined. */
	dropOffPointId?: string | null;
};

/**
 * Maps the donor's lines onto the BFF `items[]`. `qty` is sent exactly as typed — a 0 is
 * NOT coerced to 1 and an empty list is NOT replaced by a fake item; the BFF rejects
 * both with 422.
 */
export function buildDonationItemsPayload(
	items: DonationPayloadLine[],
	t: { unspecified: string; defaultItemUnit: string }
) {
	return items.map((it) => ({
		item_id: it.item_id || undefined,
		free_text: it.name || t.unspecified,
		category: it.category || undefined,
		qty: it.amount,
		unit: donationPayloadUnit(it, t.defaultItemUnit),
		condition: it.condition || undefined,
		note: it.remark || undefined,
		...(it.dropOffPointId !== undefined ? { drop_off_point_id: it.dropOffPointId } : {})
	}));
}

/**
 * Units no donor offers goods in — nutrition and dosage units the UOM master carries
 * for recipes and medicine, which only lengthen the public picker.
 */
const DONOR_HIDDEN_UNIT_CODES: ReadonlySet<string> = new Set(['kcal', 'mg', 'mcg']);

/**
 * The units a donor may pick for an item offered outside the posted needs.
 *
 * The line used to take free text, so staff reviewing it got "ลังใหญ่" or "bag" with
 * no code to match against the catalog at receipt. A picker over the UOM master keeps
 * the value a code; anything one unit cannot say ("แพ็คละ 12 ขวด") goes in the note.
 */
export function donorUnitOptions<T extends { code: string; deactivated?: boolean }>(
	units: readonly T[]
): T[] {
	return units.filter((unit) => !unit.deactivated && !DONOR_HIDDEN_UNIT_CODES.has(unit.code));
}

/** One counted line, as far as the perishable rule cares. */
export type ExpiryCheckLine = {
	item_id?: string;
	name?: string;
	perishable?: boolean;
	expiry?: string;
};

/**
 * Lines that name a perishable catalog item but carry no expiry date.
 *
 * `assertCountedAgainstCatalog` refuses these server-side (schema.md §2.1 — a
 * perishable lot without an expiry cannot be rotated or discarded on time), and the
 * ledger is append-only, so a row written without one can never be corrected.
 *
 * Mirrored on the client so staff are told which line to fix in Thai, at the point of
 * entry, instead of meeting `Perishable item item:egg requires lot.expiry to be set`
 * after filling the whole form.
 */
export function linesMissingExpiry(lines: ExpiryCheckLine[]): string[] {
	return lines
		.filter((line) => !!line.item_id && line.perishable && !line.expiry?.trim())
		.map((line) => line.name?.trim() || (line.item_id as string));
}
