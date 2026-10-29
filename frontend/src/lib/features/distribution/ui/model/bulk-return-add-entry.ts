import { parseQty, qtyGt, subQty, addQty } from '$lib/utils/qty';
import { isBulkReturnEligibleItem, type DistributionLog } from '../../domain/food-supplies';
import type {
	AddBulkReturnEntriesInput,
	AddBulkReturnEntriesResult,
	BulkReturnReturnerInput
} from '../../application/food-supplies/bulk-return-pool-v3-add-entry';
import type { FrontlineRecipientSelection } from './frontline-handover';
import { validatePositiveQuantity } from './ticket-quantity';
import { ADD_ENTRY_COPY } from './bulk-return-copy';
import {
	MISSED_LOAN_WARNING,
	listMoveTargets,
	type BulkReturnPoolRow,
	type PoolCatalogItem
} from './bulk-return-pool-v3';

/**
 * #659 — pure helpers for the "รับของเข้ากอง" (add entries) dialog. No Svelte, no I/O.
 */

export const NO_OUTSTANDING_LOAN_WARNING =
	'ผู้คืนรายนี้ไม่มีรายการยืมค้าง — บันทึกเข้ากองได้ แต่จะไม่ตัดยอดยืม';
export const LATE_RESULT_WARNING =
	'รายการเข้ากองหลังกองถูกส่งแล้ว (ค้าง) — กรุณาย้ายไปกองอื่นที่ยังเปิดอยู่';

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

export interface AddEntryLine {
	lineId: string;
	/** '' = not chosen yet. */
	item_id: string;
	/** Qty as typed. */
	qty: string;
	/** Created once per line and kept across retries (idempotency key of the entry write). */
	operationUlid: string;
	/**
	 * Set when a retry found this line's entry already moved to another pool (or its move pending
	 * sync). The line is done: it stays visible with a note and is never submitted again.
	 */
	relocated?: 'moved' | 'pending_sync';
}

/** Lines still to submit (relocated lines are done). */
export function activeLines(lines: readonly AddEntryLine[]): AddEntryLine[] {
	return lines.filter((line) => !line.relocated);
}

/** Appends an empty line; `createId` supplies the line's operationUlid (and its lineId). */
export function addLine(
	lines: readonly AddEntryLine[],
	createId: () => string,
	preset: { item_id?: string; qty?: string } = {}
): AddEntryLine[] {
	const id = createId();
	return [
		...lines,
		{ lineId: id, item_id: preset.item_id ?? '', qty: preset.qty ?? '', operationUlid: id }
	];
}

export function removeLine(lines: readonly AddEntryLine[], lineId: string): AddEntryLine[] {
	return lines.filter((line) => line.lineId !== lineId);
}

export interface AddEntryLinesValidation {
	isValid: boolean;
	/** Per-line error, keyed by lineId. */
	lineErrors: Record<string, string>;
	/** Form-level error (e.g. no line). */
	formError?: string;
}

/**
 * ≥1 line; each line needs an item and a positive whole qty; an item may appear once per submit.
 * Relocated lines are done and not validated.
 */
export function validateAddEntryLines(lines: readonly AddEntryLine[]): AddEntryLinesValidation {
	const lineErrors: Record<string, string> = {};
	const active = activeLines(lines);
	if (active.length === 0) {
		return { isValid: false, lineErrors, formError: 'กรุณาเพิ่มอย่างน้อย 1 รายการ' };
	}
	const seen = new Set<string>();
	for (const line of active) {
		if (!line.item_id) {
			lineErrors[line.lineId] = 'กรุณาเลือกสินค้า';
			continue;
		}
		if (seen.has(line.item_id)) {
			lineErrors[line.lineId] = 'สินค้านี้อยู่ในรายการแล้ว กรุณารวมจำนวนเป็นบรรทัดเดียว';
			continue;
		}
		seen.add(line.item_id);
		const qty = validatePositiveQuantity(line.qty);
		if (!qty.isValid) lineErrors[line.lineId] = qty.error ?? 'จำนวนต้องเป็นจำนวนเต็มที่ถูกต้อง';
	}
	return { isValid: Object.keys(lineErrors).length === 0, lineErrors };
}

// ---------------------------------------------------------------------------
// Returner
// ---------------------------------------------------------------------------

export type ReturnerChoice = FrontlineRecipientSelection | 'unspecified' | null;

export interface ReturnerResolution {
	returner?: BulkReturnReturnerInput;
	error?: string;
}

export function resolveReturner(choice: ReturnerChoice): ReturnerResolution {
	if (choice === 'unspecified') return { returner: { type: 'unspecified' } };
	if (!choice) return { error: 'กรุณาระบุผู้คืน หรือเลือก "ไม่ระบุผู้คืน"' };
	if (choice.recipientType === 'outside') {
		return {
			error: 'บุคคลภายนอกคืนเข้ากองไม่ได้ กรุณาเลือกผู้พักพิงหรือจิตอาสา หรือเลือก "ไม่ระบุผู้คืน"'
		};
	}
	return { returner: { type: choice.recipientType, id: choice.recipientId } };
}

/** Id used to load the outstanding loans; null for unspecified / not chosen / outside. */
export function identifiedReturnerId(choice: ReturnerChoice): string | null {
	if (!choice || choice === 'unspecified') return null;
	return choice.recipientType === 'outside' ? null : choice.recipientId;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** Builds the workflow input from already validated lines (qty canonicalised). Null when invalid. */
export function buildAddEntriesInput(args: {
	poolId: string;
	returner: BulkReturnReturnerInput;
	lines: readonly AddEntryLine[];
	notes?: string;
}): AddBulkReturnEntriesInput | null {
	const items: AddBulkReturnEntriesInput['items'] = [];
	for (const line of activeLines(args.lines)) {
		const qty = validatePositiveQuantity(line.qty);
		if (!qty.isValid || !qty.value || !line.item_id) return null;
		items.push({ item_id: line.item_id, qty: qty.value, operationUlid: line.operationUlid });
	}
	if (items.length === 0 || !args.poolId) return null;
	const notes = args.notes?.trim();
	return {
		pool_id: args.poolId,
		returner: args.returner,
		items,
		...(notes ? { notes } : {})
	};
}

// ---------------------------------------------------------------------------
// Catalog / pools
// ---------------------------------------------------------------------------

export interface AddEntryCatalogItem {
	_id: string;
	name: string;
	base_unit?: string;
	returnable?: boolean;
	deactivated?: boolean;
	merged_into?: string | null;
}

export const DEACTIVATED_ITEM_SUFFIX = ' (เลิกใช้)';

/**
 * Items the add-entry workflow accepts: exactly the returnable ones (`isBulkReturnEligibleItem`).
 * Deactivated items stay (loans of items deactivated after lending can still be returned) and get
 * a "(เลิกใช้)" suffix on their name. Sorted by Thai name.
 */
export function filterEligibleItems(items: readonly AddEntryCatalogItem[]): PoolCatalogItem[] {
	return items
		.filter((item) => isBulkReturnEligibleItem(item))
		.sort((a, b) => a.name.localeCompare(b.name, 'th'))
		.map((item) => ({
			_id: item._id,
			name: item.deactivated ? `${item.name}${DEACTIVATED_ITEM_SUFFIX}` : item.name,
			base_unit: item.base_unit
		}));
}

/** OPEN, unlocked pools a new entry can be appended to. */
export function listOpenPools(rows: readonly BulkReturnPoolRow[]) {
	return listMoveTargets(rows, '');
}

/**
 * Default pool for the add-entry form: the explicitly picked/initial pool if still open, else the
 * remembered last-used pool if still open, else the only open pool, else ''.
 */
export function resolveDefaultPoolId(input: {
	picked: string;
	remembered: string | null;
	openPools: readonly { _id: string }[];
}): string {
	const { picked, remembered, openPools } = input;
	if (picked && openPools.some((pool) => pool._id === picked)) return picked;
	if (remembered && openPools.some((pool) => pool._id === remembered)) return remembered;
	return openPools.length === 1 ? openPools[0]._id : '';
}

// ---------------------------------------------------------------------------
// Outstanding loans
// ---------------------------------------------------------------------------

export interface OutstandingLoanRow {
	logId: string;
	item_id: string;
	itemName: string;
	unit: string;
	outstanding: string;
	distributed_at: string;
}

export function outstandingLoanRows(
	loans: readonly DistributionLog[],
	catalog: readonly PoolCatalogItem[]
): OutstandingLoanRow[] {
	const rows: OutstandingLoanRow[] = [];
	for (const loan of loans) {
		const outstanding = subQty(loan.qty, loan.qty_returned ?? '0');
		if (!qtyGt(outstanding, 0)) continue;
		const master = catalog.find((item) => item._id === loan.item_id);
		rows.push({
			logId: loan._id,
			item_id: loan.item_id,
			itemName: master?.name ?? loan.item_id.replace(/^item_master:|^item:/, ''),
			unit: master?.base_unit ?? '',
			outstanding,
			distributed_at: loan.distributed_at
		});
	}
	return rows;
}

export interface LinesFromLoans {
	lines: AddEntryLine[];
	/** item_ids with an outstanding loan that the add-entry catalog cannot select. */
	skippedItemIds: string[];
	/**
	 * item_ids whose line was kept at the qty an earlier save already wrote, because the outstanding
	 * total now differs. The retry replays that entry instead of writing a different qty.
	 */
	keptAtWrittenQtyItemIds: string[];
}

/** Outstanding qty per item (summed across loans), in first-seen order. */
function outstandingTotals(rows: readonly OutstandingLoanRow[]): Map<string, string> {
	const totals = new Map<string, string>();
	for (const row of rows) {
		totals.set(row.item_id, addQty(totals.get(row.item_id) ?? '0', row.outstanding));
	}
	return totals;
}

/** Numeric equality of two typed quantities; false when either is not a number. */
function sameQty(a: string, b: string): boolean {
	try {
		return parseQty(a).eq(parseQty(b));
	} catch {
		return false;
	}
}

/**
 * operationUlids of current lines that "return all" would give a different qty and that were sent
 * in an earlier save. Only these can already have written an entry, so only these need the
 * written-entries lookup before `linesFromOutstandingLoans`.
 */
export function ulidsNeedingWrittenLookup(
	rows: readonly OutstandingLoanRow[],
	eligibleItemIds: ReadonlySet<string>,
	currentLines: readonly AddEntryLine[],
	sentUlids: ReadonlySet<string>
): string[] {
	const totals = outstandingTotals(rows);
	const ulids: string[] = [];
	for (const [item_id, qty] of totals) {
		if (!eligibleItemIds.has(item_id)) continue;
		const existing = currentLines.find((line) => !line.relocated && line.item_id === item_id);
		if (existing && sentUlids.has(existing.operationUlid) && !sameQty(existing.qty, qty)) {
			ulids.push(existing.operationUlid);
		}
	}
	return ulids;
}

/**
 * "Return all": one line per item (outstanding summed across loans), in first-seen order, limited
 * to items the form can select. `makeLine` builds each NEW line (supplies lineId / operationUlid).
 *
 * An operationUlid identifies one intended write, and replaying it with another qty collides. So
 * for an item that already has a (not relocated) line in `currentLines`:
 * - the ULID already wrote an entry (`written`): the line keeps its ULID and the WRITTEN qty, so a
 *   retry replays it (no double count); it is reported in `keptAtWrittenQtyItemIds` when the
 *   outstanding total differs;
 * - the qty is unchanged: the line is kept as it is (same ULID);
 * - otherwise the qty changed and nothing was written: a new line with a new ULID.
 * Current lines of other items are dropped, except relocated (done) lines, which are kept at the
 * end as they are.
 */
export function linesFromOutstandingLoans(
	rows: readonly OutstandingLoanRow[],
	eligibleItemIds: ReadonlySet<string>,
	makeLine: (preset: { item_id: string; qty: string }) => AddEntryLine,
	currentLines: readonly AddEntryLine[] = [],
	written: ReadonlyMap<string, { qty: string }> = new Map()
): LinesFromLoans {
	const lines: AddEntryLine[] = [];
	const skippedItemIds: string[] = [];
	const keptAtWrittenQtyItemIds: string[] = [];
	for (const [item_id, qty] of outstandingTotals(rows)) {
		if (!eligibleItemIds.has(item_id)) {
			skippedItemIds.push(item_id);
			continue;
		}
		const existing = currentLines.find((line) => !line.relocated && line.item_id === item_id);
		const saved = existing ? written.get(existing.operationUlid) : undefined;
		if (existing && saved) {
			lines.push({ ...existing, qty: saved.qty });
			if (!sameQty(saved.qty, qty)) keptAtWrittenQtyItemIds.push(item_id);
		} else if (existing && sameQty(existing.qty, qty)) {
			lines.push(existing);
		} else {
			lines.push(makeLine({ item_id, qty }));
		}
	}
	for (const line of currentLines) if (line.relocated) lines.push(line);
	return { lines, skippedItemIds, keptAtWrittenQtyItemIds };
}

/**
 * True when an identified returner is selected, the loans query has settled, and none is
 * outstanding. `isLoading` should be true while the query is pending or failed (no false alarm).
 */
export function hasNoOutstandingLoanWarning(
	returner: BulkReturnReturnerInput | null,
	loans: readonly unknown[],
	isLoading: boolean
): boolean {
	if (!returner || returner.type === 'unspecified') return false;
	if (isLoading) return false;
	return loans.length === 0;
}

// ---------------------------------------------------------------------------
// Result summary
// ---------------------------------------------------------------------------

export interface AddEntriesSummary {
	/** Newly written, on time. */
	savedCount: number;
	/** Already written by an earlier attempt (idempotent replay), on time. */
	replayedCount: number;
	/** Written but the pool stopped accepting first: must be moved to an OPEN pool. */
	lateEntries: AddBulkReturnEntriesResult['results'];
	/** Replayed lines whose entry was moved to another pool meanwhile (or is pending sync): not saved here. */
	relocated: { item_id: string; kind: 'moved' | 'pending_sync' }[];
	noOutstandingLoan: boolean;
	/**
	 * Total qty applied to loans: sum of loan refs of on-time entries that were cut (excludes
	 * loan_pending and loans_reopened lines); undefined when none.
	 */
	loanAppliedQty?: string;
	/** Items whose qty was only partly (or not) matched to a loan. */
	unallocated: { item_id: string; qty: string }[];
	/**
	 * Items written whose loan cut is still pending (the pool was locked); processing stopped at the
	 * first of them. Their loans are cut from the pool page ("ตัดยอดยืมที่ค้าง").
	 */
	loanPendingItemIds: string[];
	/** Written entries that were voided before their loan cut: no loan was touched. */
	voidedCount: number;
	/**
	 * On-time lines whose loans were reopened (reopen wins, nothing cut). They still count in
	 * saved / replayed.
	 */
	loansReopenedCount: number;
	/** The chosen pool could not take the new lines (they stay in the form). */
	blocked?: { pool_id: string; reason: 'closed' | 'locked' };
}

export function summarizeAddResult(result: AddBulkReturnEntriesResult): AddEntriesSummary {
	const relocated = result.results.filter((r) => r.relocated);
	const voided = result.results.filter((r) => r.voided && !r.late && !r.relocated);
	const onTime = result.results.filter((r) => !r.late && !r.relocated && !r.voided);
	const loanPending = onTime.filter((r) => r.loan_pending);
	// A pending line has not cut any loan yet, and a reopened line (CR-193 §35: reopen wins, nothing
	// is cut) has none either, so neither adds to the applied qty nor is listed as unallocated.
	const cut = onTime.filter((r) => !r.loan_pending && !r.loans_reopened);
	const lateEntries = result.results.filter((r) => r.late);
	let applied = '0';
	for (const r of cut) {
		for (const ref of r.entry.loan_refs) applied = addQty(applied, ref.qty);
	}
	return {
		savedCount: onTime.filter((r) => !r.replayed).length,
		replayedCount: onTime.filter((r) => r.replayed).length,
		loanPendingItemIds: loanPending.map((r) => r.entry.item_id),
		voidedCount: voided.length,
		loansReopenedCount: onTime.filter((r) => r.loans_reopened).length,
		...(result.blocked ? { blocked: result.blocked } : {}),
		lateEntries,
		relocated: relocated.map((r) => ({
			item_id: r.entry.item_id,
			kind: r.relocated as 'moved' | 'pending_sync'
		})),
		noOutstandingLoan: result.no_outstanding_loan,
		...(qtyGt(applied, 0) ? { loanAppliedQty: applied } : {}),
		unallocated: cut
			.filter((r) => r.entry.returner_id !== null && qtyGt(r.unallocated_qty, 0))
			.map((r) => ({ item_id: r.entry.item_id, qty: r.unallocated_qty }))
	};
}

/**
 * True when this call wrote into `poolId`: a newly saved on-time line, or an on-time replay whose
 * entry lives in that pool. A replay of an entry that sits in another pool does not count.
 */
export function wroteIntoPool(result: AddBulkReturnEntriesResult, poolId: string): boolean {
	return result.results.some(
		(r) => !r.late && !r.relocated && !r.voided && (!r.replayed || r.entry.pool_id === poolId)
	);
}

/** Warning naming the items whose loan cut is pending and where to finish it. */
export function loanPendingWarning(itemNames: readonly string[]): string {
	return `${MISSED_LOAN_WARNING}: ${itemNames.join(', ')} — ${ADD_ENTRY_COPY.loanPendingWhere}`;
}

/**
 * Why lines stay in the form after a save, and what to do. Call it only when active lines remain.
 * A blocked pool wins, then a loan-pending stop; otherwise a late entry made the pool stop taking
 * items.
 */
export function remainingLinesMessage(summary: AddEntriesSummary): string {
	if (summary.blocked) {
		return summary.blocked.reason === 'locked'
			? ADD_ENTRY_COPY.remainingLocked
			: ADD_ENTRY_COPY.remainingClosed;
	}
	if (summary.loanPendingItemIds.length > 0) return ADD_ENTRY_COPY.remainingLoanPending;
	return ADD_ENTRY_COPY.remainingNotAccepting;
}

/**
 * Lines still to submit after a call. A late result stops the workflow, so only the items written
 * so far are in `results`; written lines (late included: the entry exists) are dropped and the
 * rest stay for another pool / retry. A relocated line (entry moved elsewhere) is NOT dropped: it
 * stays, flagged done, so the user sees it; it is never resubmitted (see `activeLines`).
 */
export function dropWrittenLines(
	lines: readonly AddEntryLine[],
	result: AddBulkReturnEntriesResult
): AddEntryLine[] {
	const written = new Set(result.results.map((r) => r.entry._id));
	const relocated = new Map(
		result.results.flatMap((r) => (r.relocated ? [[r.entry._id, r.relocated] as const] : []))
	);
	return lines.flatMap((line) => {
		const id = `bulk_return_entry:${line.operationUlid}`;
		const kind = relocated.get(id);
		if (kind) return [{ ...line, relocated: kind }];
		return written.has(id) ? [] : [line];
	});
}
