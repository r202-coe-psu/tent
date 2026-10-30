import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw } from '$lib/server/couch-admin';
import {
	assertCountedAgainstCatalog,
	authorizeWarehouse,
	findDonationByQuery,
	isInCallerScope,
	routeErrorResponse as toRouteError,
	toCountedItems
} from '$lib/server/donation-intake';
import {
	allLinesRecorded,
	closeDonationByPoints,
	combineLineRejectReasons,
	donorRejectMessage,
	hasLineReview,
	isReceivedByPoint,
	rejectRemainingLines,
	type DonationRejectReasonCode,
	type PublicDonationDoc,
	receiveDonationInputSchema
} from '$lib/features/donations/server';
import {
	canTransitionDonation,
	deriveDonationReceiptAuditId,
	deriveDonationReceiptLineId,
	keyDonationReceipt,
	type CountedItem,
	type Donation,
	type DonationPointReceipt,
	type DonationPointReceiptItem,
	type StockLedger,
	donationShortfall
} from '$lib/features/operations/server';
import { createAuditEntry, type AuditEntry } from '$lib/features/shared';
import {
	keyedDonationRowIds,
	readCurrentDonationPoints,
	type CurrentDonationPoint
} from '$lib/server/donation-docs';
import { toScanView } from '$lib/server/donation-scan-view';
import { allocateLotNos } from '$lib/server/lot-number';
import { persistQty } from '$lib/utils/qty';

function routeErrorResponse(e: unknown) {
	const { message, status } = toRouteError(e);
	return json({ success: false, error: message }, { status });
}

type LineRejection = { reject_reason: string; reject_reason_code: DonationRejectReasonCode };

/** CR-172 FR-9 — the donor-facing reason of a line staff turned away, or null if kept. */
function rejectionOf(line: object): LineRejection | null {
	const l = line as {
		rejected?: boolean;
		reject_reason_code?: DonationRejectReasonCode;
		reject_note?: string;
	};
	if (!l.rejected || !l.reject_reason_code) return null;
	return {
		reject_reason_code: l.reject_reason_code,
		reject_reason: donorRejectMessage(l.reject_reason_code, l.reject_note)
	};
}

type BulkDocsOutcome = { id?: string; ok?: boolean; error?: string; reason?: string };

/** Ledger rows already on the shelter's ledger, by `_id` (deleted or missing ids are absent). */
async function readLedgerRows(dbName: string, ids: string[]): Promise<Map<string, StockLedger>> {
	const rows = new Map<string, StockLedger>();
	if (ids.length === 0) return rows;
	const res = await adminRaw(`/${dbName}/_all_docs?include_docs=true`, 'POST', { keys: ids });
	if (res.status >= 400) {
		throw new Error(`Failed to read the stock ledger: ${JSON.stringify(res.data)}`);
	}
	for (const row of (res.data as { rows?: { key: string; doc?: StockLedger | null }[] }).rows ??
		[]) {
		if (row.doc) rows.set(row.key, row.doc);
	}
	return rows;
}

/** Same check as the batch receive path: an append-only row cannot be "edited" by a retry. */
function recordsSameLine(row: StockLedger, line: CountedItem): boolean {
	return (
		row.item_id === line.item_id &&
		row.unit === line.unit &&
		persistQty(row.qty) === persistQty(line.qty)
	);
}

/**
 * What an earlier attempt at this receipt recorded, read off its audit entry (one per
 * donation, fixed id) — or null when there was none.
 */
async function readEarlierReceipt(
	dbName: string,
	auditId: string
): Promise<{ ledgerIds: string[]; rejectedLines: number[] } | null> {
	const res = await adminRaw(`/${dbName}/${encodeURIComponent(auditId)}`, 'GET');
	if (res.status === 404) return null;
	if (res.status >= 400) {
		throw new Error(`Failed to read the receipt audit: ${JSON.stringify(res.data)}`);
	}
	const context = ((res.data as AuditEntry).context ?? {}) as {
		ledger_ids?: string[];
		rejected_lines?: { line_no: number }[];
	};
	return {
		ledgerIds: [...(context.ledger_ids ?? [])].sort(),
		rejectedLines: (context.rejected_lines ?? []).map((line) => line.line_no).sort((a, b) => a - b)
	};
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

function receiptMismatch(lineNo: number, row: StockLedger) {
	return json(
		{
			success: false,
			error_code: 'RECEIPT_MISMATCH',
			error: `รายการที่ ${lineNo + 1} บันทึกเข้าคลังไปแล้วเป็น ${row.qty} ${row.unit} แก้จำนวนหรือสินค้าของรายการนี้ไม่ได้ — ค้นหาใบใหม่แล้วตรวจอีกครั้ง`
		},
		{ status: 409 }
	);
}

/** Re-reads after a point receipt's PUT lost a 409 (CR-206 FR-MP-23a) — 3, then give up. */
const RECEIPT_PUT_RETRIES = 3;

/**
 * Enough to see every `donation` row of one booking: one row per line, plus a line keyed
 * under another item by an older screen.
 */
const LEDGER_SCAN_LIMIT = 1000;

/** The booking as it is now, by `_id`. */
async function readDonation(dbName: string, donationId: string): Promise<PublicDonationDoc> {
	const res = await adminRaw(`/${dbName}/${encodeURIComponent(donationId)}`, 'GET');
	if (res.status >= 400) {
		throw new Error(`Failed to re-read the donation: ${JSON.stringify(res.data)}`);
	}
	return res.data as PublicDonationDoc;
}

/** What the scan station labels the boxes from (CR-088): one entry per ledger row. */
async function lotsOf(dbName: string, ledgerIds: readonly string[]) {
	const rows = await readLedgerRows(dbName, [...ledgerIds]);
	return ledgerIds.flatMap((id) => {
		const row = rows.get(id);
		return row ? [{ item_id: row.item_id, lot_no: row.lot?.lot_no ?? null }] : [];
	});
}

/** The `donation` ledger rows of this booking with their item, at most `limit` of them. */
async function donationLedgerRows(
	dbName: string,
	donationId: string,
	limit: number
): Promise<{ _id: string; item_id: string }[]> {
	const res = await adminRaw(`/${dbName}/_find`, 'POST', {
		// `item_id` is in the selector so CouchDB picks `ledger-type-refid-itemid-reason-idx`.
		selector: {
			type: 'stock_ledger',
			ref_id: donationId,
			item_id: { $gt: null },
			reason: 'donation'
		},
		fields: ['_id', 'item_id'],
		limit
	});
	if (res.status >= 400) {
		throw new Error(`Failed to read the stock ledger: ${JSON.stringify(res.data)}`);
	}
	return (res.data as { docs?: { _id: string; item_id: string }[] }).docs ?? [];
}

/** The point name staff read in a message; `null` = recorded once the shelter had no point left. */
function pointLabel(pointId: string | null, points: readonly CurrentDonationPoint[]): string {
	if (pointId === null) return 'ศูนย์ (ไม่ระบุจุด)';
	return points.find((point) => point.id === pointId)?.name || 'จุดรับบริจาคที่ถูกเลิกใช้แล้ว';
}

/**
 * How this point receipt meets what the booking already recorded (CR-206 FR-MP-22e): the
 * same receipt again (same lines → same audit id, from the same point) is a retry of one
 * that landed; a line another receipt holds is refused; anything else may go in. Another
 * point sending the very same lines is refused too (AC-15) — its count is not the one kept.
 */
function receiptOverlap(
	donation: PublicDonationDoc,
	lineNos: readonly number[],
	auditId: string,
	pointId: string | null
):
	| { kind: 'retry'; receipt: DonationPointReceipt }
	| { kind: 'taken'; lineNo: number; receipt: DonationPointReceipt }
	| null {
	const receipts = donation.point_receipts ?? [];
	const same = receipts.find(
		(receipt) => receipt.audit_id === auditId && receipt.point_id === pointId
	);
	if (same) return { kind: 'retry', receipt: same };
	for (const receipt of receipts) {
		const lineNo = receipt.line_nos.find((n) => lineNos.includes(n));
		if (lineNo !== undefined) return { kind: 'taken', lineNo, receipt };
	}
	return null;
}

function lineAlreadyReceived(
	overlap: { lineNo: number; receipt: DonationPointReceipt },
	points: readonly CurrentDonationPoint[]
) {
	return json(
		{
			success: false,
			error_code: 'LINE_ALREADY_RECEIVED',
			error: `รายการที่ ${overlap.lineNo + 1} รับไปแล้วที่ ${pointLabel(overlap.receipt.point_id, points)} — ค้นหาใบใหม่แล้วตรวจอีกครั้ง`
		},
		{ status: 409 }
	);
}

export const GET: RequestHandler = async ({ params, request }) => {
	try {
		const caller = await authorizeWarehouse(request.headers.get('cookie'));
		const { query } = params;
		if (!query) {
			return json({ success: false, error: 'Query parameter is required' }, { status: 400 });
		}

		const found = await findDonationByQuery(query);
		if (!found) {
			return json({ success: false, error: 'Donation not found' }, { status: 404 });
		}

		// Shelter-scope isolation: non-SA callers may only see donations of their own shelter.
		if (!isInCallerScope(caller, found.donation)) {
			return json({ success: false, error: 'Forbidden' }, { status: 403 });
		}

		return json({
			success: true,
			donation: toScanView(found.donation)
		});
	} catch (e) {
		return routeErrorResponse(e);
	}
};

export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const caller = await authorizeWarehouse(request.headers.get('cookie'));
		const { query } = params;
		if (!query) {
			return json({ success: false, error: 'Query parameter is required' }, { status: 400 });
		}

		const found = await findDonationByQuery(query);
		if (!found) {
			return json({ success: false, error: 'Donation not found' }, { status: 404 });
		}

		// Shelter-scope isolation: non-SA callers may only receive donations of their own shelter.
		if (!isInCallerScope(caller, found.donation)) {
			return json({ success: false, error: 'Forbidden' }, { status: 403 });
		}

		const body = await request.json();
		const parsed = receiveDonationInputSchema.safeParse(body);
		if (!parsed.success) {
			return json(
				{ success: false, error: 'Invalid input', details: parsed.error.flatten() },
				{ status: 422 }
			);
		}

		const { donation, dbName } = found;
		if (parsed.data.line_nos?.some((lineNo) => lineNo >= (donation.items ?? []).length)) {
			return json(
				{
					success: false,
					error_code: 'INVALID_LINE_NOS',
					error: 'line_nos must name lines of this donation'
				},
				{ status: 422 }
			);
		}

		// CR-206 FR-MP-22 — `line_nos` makes this one drop-off point's receipt of those lines;
		// without it the whole booking is received at once, as before (FR-MP-24).
		const lineNos = parsed.data.line_nos
			? [...parsed.data.line_nos].sort((a, b) => a - b)
			: undefined;
		// One audit entry per receipt (#695): per booking, or per set of lines (FR-MP-22c).
		const auditId = await deriveDonationReceiptAuditId(donation._id, lineNos);

		// FR-MP-22e — the same lines again after a receipt that landed but whose answer was lost:
		// answer with the booking as it is, writing nothing. Checked before `expected_rev`, which
		// that receipt moved on from the copy the screen still holds.
		if (lineNos) {
			const overlap = receiptOverlap(donation, lineNos, auditId, parsed.data.point_id ?? null);
			if (overlap?.kind === 'retry') {
				return json({
					success: true,
					donation: toScanView(donation),
					lots: await lotsOf(dbName, overlap.receipt.ledger_ids)
				});
			}
		}

		// FR-25 / FR-25a — before anything is keyed: what staff counted has to be the
		// booking as it is now, not as it was when the screen loaded.
		if (parsed.data.expected_rev !== donation._rev) {
			return json(
				{
					success: false,
					error_code: 'DONATION_CHANGED',
					error: 'ใบบริจาคถูกแก้ไขหลังจากเปิดหน้าตรวจรับ — ค้นหาใบใหม่แล้วตรวจอีกครั้ง'
				},
				{ status: 409 }
			);
		}

		/**
		 * What may still be received.
		 *
		 * This route deliberately does NOT gate on `canTransitionDonation`: a
		 * `pending_review` booking can be received straight from the counter, because
		 * scanning the QR is a DATA-ENTRY shortcut, not a shortcut past review — staff
		 * still work the drop-off screen line by line (count, storage zone, "ผ่านการ
		 * ตรวจสอบแล้ว" per item) before this request is sent. The verification is the
		 * counting, not an intermediate doc status. Do not "tighten" this into
		 * `canTransitionDonation(status, 'received')`: §2.3 has no
		 * `pending_review → received` edge and the whole scan flow would answer 422.
		 *
		 * But every TERMINAL status has to be refused, and only `received` was. A
		 * donation that was rejected, redirected, expired or cancelled could still be
		 * received into stock:
		 *
		 * · `redirected` — the destination shelter is holding the same goods on its own
		 *   ticket, so counting them here books one delivery into two shelters;
		 * · `rejected` — the refusal, reason and audit entry say the goods were turned
		 *   away, while the ledger says they are on the shelf;
		 * · `expired` — the nightly TTL job (`quota/expiry.py`) flips any booking still
		 *   awaiting drop-off, `verifying` included, so a delivery being counted at
		 *   midnight can lapse mid-count. Its quota has already been handed back to
		 *   other donors; receiving it anyway spends a target twice.
		 *
		 * Recovery for a lapsed delivery that IS physically on the counter is the
		 * walk-in form — it mints a fresh donation and receives it in one step.
		 */
		const TERMINAL_STATUSES = new Set([
			'received',
			'rejected',
			'redirected',
			'expired',
			'cancelled'
		]);
		if (TERMINAL_STATUSES.has(donation.status)) {
			return json(
				{
					success: false,
					error_code: donation.status === 'received' ? 'ALREADY_RECEIVED' : 'DONATION_CLOSED',
					error:
						donation.status === 'received'
							? 'Donation is already received (LOCKED)'
							: `Cannot receive a donation with status "${donation.status}" — คีย์เป็น Walk-in ใหม่ถ้าของอยู่ที่เคาน์เตอร์จริง`
				},
				{ status: 400 }
			);
		}

		// CR-206 — the shelter's drop-off points as staff set them up now, from the registry doc
		// (FR-MP-2a), read only when the booking or the request has anything to do with points.
		const pointId = parsed.data.point_id ?? null;
		const touchesPoints =
			lineNos !== undefined ||
			(donation.point_receipts ?? []).length > 0 ||
			(donation.items ?? []).some((item) => (item.drop_off_point_id ?? null) !== null);
		const points = touchesPoints ? await readCurrentDonationPoints(donation.shelter_code) : [];
		const currentPointIds = new Set(points.map((point) => point.id));
		if (!lineNos) {
			// FR-MP-22a — a booking with a line on a point the shelter still offers, or one a point
			// already started, is received point by point: an older screen sending the whole
			// booking would close it before the other points' goods arrive.
			if (isReceivedByPoint(donation, currentPointIds)) {
				return json(
					{
						success: false,
						error_code: 'LINE_NOS_REQUIRED',
						error:
							'ใบนี้แยกส่งหลายจุด — เลือกจุดที่ประจำแล้วรับเฉพาะรายการของจุดนั้น (โหลดหน้าสแกนใหม่ถ้าไม่เห็นตัวเลือกจุด)'
					},
					{ status: 422 }
				);
			}
		} else if (pointId === null) {
			// FR-MP-18b — "no point" is only for a shelter that has none left (AC-24).
			if (points.length > 0) {
				return json(
					{
						success: false,
						error_code: 'POINT_REQUIRED',
						error: 'ศูนย์นี้มีจุดรับบริจาค — เลือกจุดที่ประจำก่อนบันทึกรับของ'
					},
					{ status: 422 }
				);
			}
		} else if (!currentPointIds.has(pointId)) {
			// A point unticked or deleted since the screen loaded: the receipt would name a point
			// the shelter no longer has. Staff pick again from what is there now.
			return json(
				{
					success: false,
					error_code: 'UNKNOWN_DROP_OFF_POINT',
					error:
						'จุดที่ประจำที่เลือกไม่ได้เป็นจุดรับบริจาคของศูนย์แล้ว — โหลดหน้าใหม่แล้วเลือกจุดอีกครั้ง'
				},
				{ status: 422 }
			);
		}
		if (lineNos) {
			const overlap = receiptOverlap(donation, lineNos, auditId, pointId);
			if (overlap?.kind === 'taken') return lineAlreadyReceived(overlap, points);
		}
		/** Lines this request records — all of them for a whole-booking receipt. */
		const inReceipt = (lineNo: number) => !lineNos || lineNos.includes(lineNo);

		// What staff actually counted; falls back to the declared lines when the
		// UI sends none (walk-through with nothing changed).
		const countedLines = parsed.data.items ?? donation.items;
		// `line_no` is the line's position in what was sent, free-text lines included. The
		// scan station sends one line per `donation.items[]` entry in order — the numbering
		// of the batch receive page too (`initialBatchDrafts`) — so both address one row.
		// A line refused at review stays refused, with the reason the donor was already given
		// (CR-174): the counter cannot quietly receive it, nor shorten what the donor reads.
		const declaredLines = donation.items ?? [];
		const rejections = (countedLines ?? []).map((line, lineNo) => {
			const declared = declaredLines[lineNo];
			if (declared?.review_status === 'rejected') {
				const code = (declared.review_reason_code ?? 'other') as DonationRejectReasonCode;
				return {
					reject_reason_code: code,
					reject_reason: declared.review_reason?.trim() || donorRejectMessage(code)
				};
			}
			return rejectionOf(line);
		});
		// A rejected line keys no ledger row and gets no lot (CR-172 FR-10) — but keeps its
		// number, so the lines after it still address the same rows. A point receipt keys only
		// its own lines (FR-MP-22): the others are not touched at all.
		const numbered = (countedLines ?? []).flatMap((line, lineNo) =>
			!inReceipt(lineNo) || rejections[lineNo]
				? []
				: toCountedItems([line]).map((item) => ({ lineNo, item }))
		);
		const counted = numbered.map(({ item }) => item);

		// Row ids are fixed by (donation, item, line) (CR-143 FR-B4a), so a retry — e.g.
		// after the donation PUT below lost a 409 — finds the rows the first attempt wrote
		// instead of keying the same goods into stock twice (#695). The same ids hold across
		// points: `line_no` cannot move once a point has received (CR-206 FR-MP-22b).
		const ids = await Promise.all(
			numbered.map(({ lineNo, item }) =>
				deriveDonationReceiptLineId(donation._id, item.item_id, lineNo)
			)
		);

		const nowStr = new Date().toISOString();
		// FR-MP-22f — what this point recorded, line by line: `received_summary.items[]` plus
		// `line_no`. `items[]` is never rewritten; the summary is written once, at close.
		const receipt: DonationPointReceipt | null = lineNos
			? {
					point_id: pointId,
					line_nos: lineNos,
					received_at: nowStr,
					received_by: caller.name,
					audit_id: auditId,
					ledger_ids: ids,
					items: lineNos.map((lineNo): DonationPointReceiptItem => {
						const line = (countedLines ?? [])[lineNo];
						const rejection = rejections[lineNo];
						return {
							line_no: lineNo,
							...('item_id' in line && line.item_id ? { item_id: line.item_id } : {}),
							...('free_text' in line && line.free_text ? { free_text: line.free_text } : {}),
							qty: rejection ? '0' : String(line.qty),
							unit: line.unit,
							...(rejection ? { rejected: true, ...rejection } : {})
						};
					}),
					...(parsed.data.remarks ? { remarks: parsed.data.remarks } : {})
				}
			: null;
		/**
		 * The booking with this receipt appended (FR-MP-22f) and, once every line has a result,
		 * closed in the same write (FR-MP-23, FR-MP-27a) — or null when closing would reject a
		 * booking that cannot be rejected (nothing received across every point, CR-172 FR-12).
		 */
		const withReceipt = (
			doc: PublicDonationDoc,
			pointReceipt: DonationPointReceipt
		): PublicDonationDoc | null => {
			const next: PublicDonationDoc = {
				...doc,
				point_receipts: [...(doc.point_receipts ?? []), pointReceipt],
				updated_at: nowStr
			};
			if (!allLinesRecorded(next)) return next;
			const closed = closeDonationByPoints(next, {
				closedBy: caller.name,
				closedReason: 'all_points',
				now: nowStr
			});
			if (closed.status === 'rejected' && !canTransitionDonation(doc.status, 'rejected')) {
				return null;
			}
			return { ...next, ...closed };
		};

		// FR-12 — nothing kept means the booking is refused, not received.
		const allRejected = !receipt && rejections.length > 0 && rejections.every(Boolean);
		if (
			(allRejected && !canTransitionDonation(donation.status, 'rejected')) ||
			(receipt && withReceipt(donation, receipt) === null)
		) {
			return json(
				{
					success: false,
					error_code: 'INVALID_TRANSITION',
					error: `Cannot reject a donation with status "${donation.status}"`
				},
				{ status: 422 }
			);
		}

		try {
			await assertCountedAgainstCatalog(counted, dbName);
		} catch (e) {
			return json(
				{
					success: false,
					error_code: 'CATALOG_MISMATCH',
					error: e instanceof Error ? e.message : 'Invalid counted items'
				},
				{ status: 422 }
			);
		}

		const ctx = { shelterCode: donation.shelter_code, createdBy: caller.name };

		// A retry must repeat the receipt it retries (#695). Rows are found by id, so a line
		// switched to "ไม่รับ", or mapped to another item, after an attempt that already
		// keyed it would leave that row behind or key the goods twice. The earlier attempt's
		// audit says which rows and refusals it recorded; anything else is refused. A point
		// receipt is compared with the attempt at the same lines only (FR-MP-22d).
		const earlier = await readEarlierReceipt(dbName, auditId);
		if (
			earlier &&
			(!sameList(earlier.ledgerIds, [...ids].sort()) ||
				!sameList(
					earlier.rejectedLines,
					rejections.flatMap((r, lineNo) => (r && inReceipt(lineNo) ? [lineNo] : []))
				))
		) {
			return json(
				{
					success: false,
					error_code: 'RECEIPT_MISMATCH',
					error:
						'ใบนี้เคยบันทึกเข้าคลังไปแล้วด้วยผลตรวจชุดเดิม — ผลที่ส่งมาต่างจากครั้งก่อน (รายการที่รับ/ไม่รับ หรือสินค้าที่จับคู่) ค้นหาใบใหม่แล้วตรวจให้ตรงกับครั้งก่อน หรือแจ้งผู้ดูแลระบบ'
				},
				{ status: 409 }
			);
		}

		const recorded = await readLedgerRows(dbName, ids);
		const pending: number[] = [];
		for (const [index, { lineNo, item }] of numbered.entries()) {
			const row = recorded.get(ids[index]);
			if (!row) pending.push(index);
			else if (!recordsSameLine(row, item)) return receiptMismatch(lineNo, row);
		}
		// Ids only match a count that mapped every line the same way. The batch receive page
		// (or this screen before a reload) may have keyed a line as another item under another
		// id, and the booking stays open, so its `_rev` cannot tell. The ledger can: any row
		// of this booking outside `ids` means the goods are already in stock.
		//
		// A point receipt looks at its own lines only (FR-MP-22d): rows another receipt lists
		// are that receipt's, and a row derived from a line outside `line_nos` is another point
		// saving at the same moment, its receipt not on the booking yet (AC-14). A row of one of
		// our lines under another id — or one no line of the booking derives — still refuses.
		const lineCount = Math.max(declaredLines.length, (countedLines ?? []).length);
		const lineOfRow = async (row: { _id: string; item_id: string }) => {
			for (let lineNo = 0; lineNo < lineCount; lineNo++) {
				if ((await deriveDonationReceiptLineId(donation._id, row.item_id, lineNo)) === row._id) {
					return lineNo;
				}
			}
			return null;
		};
		const keyedForThisReceipt = async (): Promise<boolean> => {
			const listed = new Set((donation.point_receipts ?? []).flatMap((r) => r.ledger_ids));
			for (const row of await donationLedgerRows(dbName, donation._id, LEDGER_SCAN_LIMIT)) {
				if (ids.includes(row._id) || listed.has(row._id)) continue;
				const lineNo = await lineOfRow(row);
				if (lineNo === null || inReceipt(lineNo)) return true;
			}
			return false;
		};
		if (
			pending.length > 0 &&
			(receipt
				? await keyedForThisReceipt()
				: (await keyedDonationRowIds(dbName, donation._id, ids.length + 1)).some(
						(id) => !ids.includes(id)
					))
		) {
			return json(
				{
					success: false,
					error_code: 'RECEIPT_MISMATCH',
					error:
						'ใบนี้มีของบันทึกเข้าคลังไว้แล้วที่ไม่ตรงกับรายการที่นับรอบนี้ (เช่น เลือกสินค้าคนละตัวกับครั้งก่อน) — ไม่ได้บันทึกซ้ำ เลือกสินค้าให้ตรงกับที่บันทึกไว้ หรือติดต่อผู้ดูแลเพื่อตรวจยอด'
				},
				{ status: 409 }
			);
		}

		// Lot labels are minted here, not on the client: the per-day sequence needs
		// to see every row already on this shelter's ledger (CR-088 · schema.md §2.1).
		// Only rows not written yet get one; a recorded row keeps the label it was given.
		const lotNos = await allocateLotNos(dbName, pending.length);
		const pendingWithLots: CountedItem[] = pending.map((index, i) => ({
			...counted[index],
			lot: { ...(counted[index].lot ?? {}), lot_no: lotNos[i] }
		}));

		// 1) Ledger — the ONLY path from a donation into stock. Positive entries,
		//    reason `donation`, ref_id back to the donation (couchdb-mongodb-sync.md §4.2).
		const keyed = keyDonationReceipt(
			donation as unknown as Donation,
			pendingWithLots,
			ctx,
			pending.map((index) => ids[index])
		);
		const keyedById = new Map(keyed.map((row) => [row._id, row]));
		const ledgerAt = (id: string): StockLedger =>
			(recorded.get(id) ?? keyedById.get(id)) as StockLedger;

		// 2) Audit — who received what, from which booking, declared vs actual.
		//    No donor PII in `context`: the booking ref is the donor-facing handle.
		const declaredSnapshot = (donation.items ?? [])
			.flatMap((it, lineNo) => (inReceipt(lineNo) ? [it] : []))
			.map((it) => ({
				item_id: it.item_id ?? null,
				free_text: it.free_text ?? null,
				qty: it.qty,
				unit: it.unit
			}));
		const receivedSnapshot = (countedLines ?? [])
			.flatMap((it, lineNo) => (inReceipt(lineNo) ? [it] : []))
			.map((it) => ({
				item_id: it.item_id ?? null,
				free_text: it.free_text ?? null,
				qty: it.qty,
				unit: it.unit
			}));
		const audit: AuditEntry = createAuditEntry(
			{
				action: 'manual_adjust',
				target_type: 'donation',
				target_id: donation._id,
				reason: receipt
					? `ตรวจรับบริจาคที่ศูนย์ — ${pointLabel(pointId, points)} (${donation.booking_ref ?? donation._id})`
					: `ตรวจรับบริจาคที่ศูนย์ (${donation.booking_ref ?? donation._id})`,
				context: {
					booking_ref: donation.booking_ref ?? null,
					received_by: caller.name,
					// FR-MP-22c — which point recorded which lines.
					...(receipt ? { point_id: pointId, line_nos: lineNos } : {}),
					declared_items: declaredSnapshot,
					received_items: receivedSnapshot,
					has_discrepancy: JSON.stringify(declaredSnapshot) !== JSON.stringify(receivedSnapshot),
					ledger_ids: ids,
					lot_nos: ids.map((id) => ledgerAt(id).lot?.lot_no ?? null),
					rejected_lines: rejections.flatMap((r, lineNo) =>
						r && inReceipt(lineNo) ? [{ line_no: lineNo, ...r }] : []
					),
					free_text_lines_skipped:
						(countedLines ?? []).filter((_, lineNo) => inReceipt(lineNo)).length -
						counted.length -
						rejections.filter((r, lineNo) => r && inReceipt(lineNo)).length
				}
			},
			ctx,
			// One entry per receipt: a retry of the same receipt is not a second event.
			auditId
		);

		// Ledger + audit go in FIRST. If this fails the donation stays `declared`
		// and staff can key it again — the fixed ids make that retry safe.
		const appendRes = await adminRaw(`/${dbName}/_bulk_docs`, 'POST', {
			docs: [...keyed, audit]
		});
		if (appendRes.status >= 400) {
			throw new Error(
				`Failed to write stock ledger / audit trail: ${JSON.stringify(appendRes.data)}`
			);
		}
		// `_bulk_docs` answers 201 even when single docs are refused. A conflict means the
		// doc is already there — for the audit entry that is the earlier attempt; for a
		// ledger row (a concurrent receive) it only counts if it recorded the same line.
		const outcomes = Array.isArray(appendRes.data) ? (appendRes.data as BulkDocsOutcome[]) : [];
		const refused = outcomes.filter((o) => o.error && o.error !== 'conflict');
		if (refused.length > 0) {
			throw new Error(`Failed to write stock ledger / audit trail: ${JSON.stringify(refused)}`);
		}
		const raced = outcomes
			.filter((o) => o.error === 'conflict' && o.id && keyedById.has(o.id))
			.map((o) => o.id as string);
		if (raced.length > 0) {
			const landed = await readLedgerRows(dbName, raced);
			for (const id of raced) {
				const index = ids.indexOf(id);
				const row = landed.get(id);
				if (!row) throw new Error(`Stock ledger row ${id} conflicted but cannot be read`);
				if (!recordsSameLine(row, counted[index])) {
					return receiptMismatch(numbered[index].lineNo, row);
				}
				recorded.set(id, row);
			}
		}

		const lots = () =>
			ids.map((id) => {
				const row = ledgerAt(id);
				return { item_id: row.item_id, lot_no: row.lot?.lot_no ?? null };
			});

		// 3) CR-206 — a point receipt is appended to the booking, never written over it.
		if (receipt && lineNos) {
			let current = donation;
			for (let attempt = 0; ; attempt++) {
				const next = withReceipt(current, receipt);
				if (!next) {
					return json(
						{
							success: false,
							error_code: 'INVALID_TRANSITION',
							error: `Cannot reject a donation with status "${current.status}"`
						},
						{ status: 422 }
					);
				}
				const putRes = await adminRaw(
					`/${dbName}/${encodeURIComponent(donation._id)}`,
					'PUT',
					next
				);
				if (putRes.status < 400) {
					// The screen may record more lines of this booking (FR-MP-21): it needs the new rev.
					const rev = (putRes.data as { rev?: string } | null)?.rev;
					return json({
						success: true,
						donation: toScanView(rev ? { ...next, _rev: rev } : next),
						lots: lots()
					});
				}
				if (putRes.status !== 409) {
					throw new Error(`Failed to update donation to CouchDB: ${JSON.stringify(putRes.data)}`);
				}
				// FR-MP-23a — another point (or a close) wrote the booking after the rev check.
				// The rows above are in and keep their ids, so a later retry keys nothing twice.
				if (attempt >= RECEIPT_PUT_RETRIES) {
					return json(
						{
							success: false,
							error_code: 'DONATION_CONFLICT',
							error:
								'ใบบริจาคถูกแก้ไขระหว่างบันทึก — ค้นหาใบใหม่แล้วกดรับอีกครั้งได้ ของที่บันทึกไปแล้วจะไม่เข้าคลังซ้ำ'
						},
						{ status: 409 }
					);
				}
				const latest = await readDonation(dbName, donation._id);
				const overlap = receiptOverlap(latest, lineNos, auditId, pointId);
				if (overlap?.kind === 'retry') {
					return json({ success: true, donation: toScanView(latest), lots: lots() });
				}
				if (TERMINAL_STATUSES.has(latest.status)) {
					// Closed by staff or the worker while this point was keying: the rows are in
					// stock but outside the booking's result. Someone has to reconcile them.
					return json(
						{
							success: false,
							error_code: 'DONATION_CLOSED',
							error:
								ids.length > 0
									? 'ใบนี้ถูกปิดไปแล้วระหว่างบันทึก — ของที่สแกนครั้งนี้ลงคลังแล้ว แต่ไม่อยู่ในผลรับของของใบ แจ้งผู้ดูแลคลังเพื่อตรวจยอด'
									: 'ใบนี้ถูกปิดไปแล้วระหว่างบันทึก — ผลที่บันทึกครั้งนี้ไม่อยู่ในใบ (ไม่มีของเข้าคลังจากครั้งนี้)',
							lots: lots()
						},
						{ status: 409 }
					);
				}
				if (overlap) return lineAlreadyReceived(overlap, points);
				current = latest;
			}
		}

		// 4) Donation stays the record of what was DECLARED — `items` is never
		//    overwritten (the projector mirrors it as `items_declared`). What was
		//    actually received lands on `received_summary` (couchdb-mongodb-sync.md §3.2).
		// "ไม่รับ" is not "ขาด" (CR-172 FR-13): a rejected line leaves the comparison on both
		// sides — the counted lines are the declared ones, in the same order.
		// A typed-in line is compared under the stock item staff matched it to at the counter —
		// keyed by the donor's own words it never met its count and read as a shortfall.
		const declaredForShortfall = (donation.items ?? []).flatMap((it, index) => {
			if (rejections[index]) return [];
			const countedLine = countedLines?.[index];
			const matched = countedLine && 'item_id' in countedLine ? countedLine.item_id : undefined;
			return [{ item_id: it.item_id || matched || it.free_text, qty: String(it.qty) }];
		});
		const countedForShortfall = (countedLines ?? [])
			.filter((_, index) => !rejections[index])
			.map((c) => ({
				item_id:
					'item_id' in c && c.item_id ? c.item_id : 'free_text' in c ? c.free_text : undefined,
				qty: String(c.qty)
			}));
		const shortfalls = donationShortfall(declaredForShortfall, countedForShortfall);
		const lineRejections = rejections.filter((r): r is LineRejection => r !== null);

		const updated: PublicDonationDoc = {
			...donation,
			...(allRejected
				? {
						status: 'rejected' as const,
						...combineLineRejectReasons(lineRejections),
						// CR-174 FR-12 — the lines go with the booking.
						...(hasLineReview(donation.items)
							? { items: rejectRemainingLines(donation.items ?? []) }
							: {})
					}
				: { status: 'received' as const, received_at: nowStr }),
			updated_at: nowStr,
			received_summary: {
				total_items: (countedLines ?? []).length,
				received_at: nowStr,
				...(parsed.data.remarks ? { remarks: parsed.data.remarks } : {}),
				shortfalls: shortfalls.map((s) => ({
					item_id: s.item_id,
					declared: s.declared,
					counted: s.counted,
					short: s.short
				})),
				items: (countedLines ?? []).map((c, index) => ({
					item_id: 'item_id' in c ? c.item_id : undefined,
					free_text: 'free_text' in c ? c.free_text : undefined,
					qty: rejections[index] ? '0' : String(c.qty),
					unit: c.unit,
					...(rejections[index] ? { rejected: true, ...rejections[index] } : {})
				}))
			}
		};

		const saveRes = await adminRaw(`/${dbName}/${donation._id}`, 'PUT', updated);
		if (saveRes.status === 409) {
			return json(
				{
					success: false,
					error_code: 'DONATION_CONFLICT',
					// The ledger rows are in and keep their ids: receiving again is safe (#695).
					error:
						'ใบบริจาคถูกแก้ไขระหว่างบันทึก — ค้นหาใบใหม่แล้วกดรับอีกครั้งได้ ของที่บันทึกไปแล้วจะไม่เข้าคลังซ้ำ'
				},
				{ status: 409 }
			);
		}
		if (saveRes.status >= 400) {
			throw new Error(`Failed to update donation to CouchDB: ${JSON.stringify(saveRes.data)}`);
		}

		return json({
			success: true,
			donation: toScanView(updated),
			// Staff label the physical boxes from this (CR-088) — `toScanView` is the
			// donation projection and has no room for per-ledger-row data.
			lots: lots()
		});
	} catch (e) {
		return routeErrorResponse(e);
	}
};
