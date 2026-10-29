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
	combineLineRejectReasons,
	donorRejectMessage,
	hasLineReview,
	maskDonorEmail,
	maskDonorName,
	maskDonorPhone,
	rejectRemainingLines,
	type DonationRejectReasonCode,
	type PublicDonationDoc,
	type ScanDonationView,
	receiveDonationInputSchema
} from '$lib/features/donations/server';
import {
	canTransitionDonation,
	deriveDonationReceiptAuditId,
	deriveDonationReceiptLineId,
	keyDonationReceipt,
	type CountedItem,
	type Donation,
	type StockLedger,
	donationShortfall
} from '$lib/features/operations/server';
import { createAuditEntry, type AuditEntry } from '$lib/features/shared';
import { keyedDonationRowIds } from '$lib/server/donation-docs';
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

// Project a raw donation doc to the redacted view the scan UI needs (no
// tracking_token_hash, phone_hash, timestamps). Full phone kept for warehouse staff while the
// goods are still on their way; `_rev` goes out as `rev` and comes back as `expected_rev`
// (CR-174 FR-25). A RECEIVED donation's contact is masked: its full values leave only through
// `POST …/contact`, which writes an audit row (CR-214 FR-8b / FR-10a). The scan station turns
// a received booking away anyway, so nothing there needs the full contact.
function toScanView(d: PublicDonationDoc): ScanDonationView {
	const masked = d.status === 'received';
	return {
		// CR-174 FR-25 — the counter sends it back so a booking the donor changed while
		// the boxes were being counted is refused instead of received as it was.
		rev: d._rev,
		booking_ref: d.booking_ref,
		shelter_code: d.shelter_code,
		status: d.status,
		donor: masked
			? {
					name: maskDonorName(d.donor?.name),
					phone: d.donor?.phone ? maskDonorPhone(d.donor.phone) : null,
					email: maskDonorEmail(d.donor?.email)
				}
			: {
					name: d.donor?.name ?? '',
					phone: d.donor?.phone ?? null,
					email: d.donor?.email ?? null
				},
		items: (d.items ?? []).map((it) => ({
			item_id: it.item_id,
			free_text: it.free_text,
			qty: it.qty,
			unit: it.unit,
			...(it.note?.trim() ? { note: it.note.trim() } : {}),
			review_status: it.review_status,
			review_reason_code: (it.review_reason_code ?? null) as DonationRejectReasonCode | null,
			review_reason: it.review_reason ?? null
		})),
		logistics: d.logistics,
		photos: d.photos ?? []
	};
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
		// number, so the lines after it still address the same rows.
		const numbered = (countedLines ?? []).flatMap((line, lineNo) =>
			rejections[lineNo] ? [] : toCountedItems([line]).map((item) => ({ lineNo, item }))
		);
		const counted = numbered.map(({ item }) => item);
		// FR-12 — nothing kept means the booking is refused, not received.
		const allRejected = rejections.length > 0 && rejections.every(Boolean);
		if (allRejected && !canTransitionDonation(donation.status, 'rejected')) {
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

		// Row ids are fixed by (donation, item, line) (CR-143 FR-B4a), so a retry — e.g.
		// after the donation PUT below lost a 409 — finds the rows the first attempt wrote
		// instead of keying the same goods into stock twice (#695).
		const ids = await Promise.all(
			numbered.map(({ lineNo, item }) =>
				deriveDonationReceiptLineId(donation._id, item.item_id, lineNo)
			)
		);
		// A retry must repeat the receipt it retries (#695). Rows are found by id, so a line
		// switched to "ไม่รับ", or mapped to another item, after an attempt that already
		// keyed it would leave that row behind or key the goods twice. The earlier attempt's
		// audit says which rows and refusals it recorded; anything else is refused.
		const auditId = await deriveDonationReceiptAuditId(donation._id);
		const earlier = await readEarlierReceipt(dbName, auditId);
		if (
			earlier &&
			(!sameList(earlier.ledgerIds, [...ids].sort()) ||
				!sameList(
					earlier.rejectedLines,
					rejections.flatMap((r, lineNo) => (r ? [lineNo] : []))
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
		if (
			pending.length > 0 &&
			(await keyedDonationRowIds(dbName, donation._id, ids.length + 1)).some(
				(id) => !ids.includes(id)
			)
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
		const declaredSnapshot = (donation.items ?? []).map((it) => ({
			item_id: it.item_id ?? null,
			free_text: it.free_text ?? null,
			qty: it.qty,
			unit: it.unit
		}));
		const receivedSnapshot = (countedLines ?? []).map((it) => ({
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
				reason: `ตรวจรับบริจาคที่ศูนย์ (${donation.booking_ref ?? donation._id})`,
				context: {
					booking_ref: donation.booking_ref ?? null,
					received_by: caller.name,
					declared_items: declaredSnapshot,
					received_items: receivedSnapshot,
					has_discrepancy: JSON.stringify(declaredSnapshot) !== JSON.stringify(receivedSnapshot),
					ledger_ids: ids,
					lot_nos: ids.map((id) => ledgerAt(id).lot?.lot_no ?? null),
					rejected_lines: rejections.flatMap((r, lineNo) => (r ? [{ line_no: lineNo, ...r }] : [])),
					free_text_lines_skipped:
						(countedLines ?? []).length - counted.length - rejections.filter(Boolean).length
				}
			},
			ctx,
			// One entry per donation: a retry of the same receipt is not a second event.
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

		const nowStr = new Date().toISOString();
		// 3) Donation stays the record of what was DECLARED — `items` is never
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
			lots: ids.map((id) => {
				const row = ledgerAt(id);
				return { item_id: row.item_id, lot_no: row.lot?.lot_no ?? null };
			})
		});
	} catch (e) {
		return routeErrorResponse(e);
	}
};
