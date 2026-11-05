import { DEFAULT_STORAGE_LABEL, isStoragePointChosen } from '$lib/features/operations';
import type {
	BulkReturnPoolDiscrepancyReason,
	BulkReturnPoolItemSummaryRow,
	BulkReturnPoolV3
} from '../../domain/food-supplies';
import type { ReceiveBulkReturnPoolInput } from '../../application/food-supplies/bulk-return-pool-v3-lifecycle';
import {
	POOL_LOCKED_REASON,
	isPoolEditable,
	resolveItemDisplay,
	type BulkReturnPoolRow,
	type PoolCatalogItem
} from './bulk-return-pool-v3';

/**
 * #660 — pure view-model helpers for submitting a bulk return pool to the warehouse and for the
 * warehouse receive form / record. No Svelte, no I/O.
 */

// ---------------------------------------------------------------------------
// Discrepancy reasons
// ---------------------------------------------------------------------------

export const DISCREPANCY_REASON_LABELS: Record<BulkReturnPoolDiscrepancyReason, string> = {
	damaged: 'ชำรุด',
	missing: 'สูญหาย',
	miscount: 'นับผิด',
	other: 'อื่น ๆ'
};

export const DISCREPANCY_REASON_OPTIONS: readonly {
	value: BulkReturnPoolDiscrepancyReason;
	label: string;
}[] = (['damaged', 'missing', 'miscount', 'other'] as const).map((value) => ({
	value,
	label: DISCREPANCY_REASON_LABELS[value]
}));

export function discrepancyReasonLabel(reason: BulkReturnPoolDiscrepancyReason): string {
	return DISCREPANCY_REASON_LABELS[reason];
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

export const SUBMIT_EMPTY_REASON = 'กองนี้ยังไม่มีรายการ ส่งเข้าคลังไม่ได้ — ยกเลิกกองแทน';
export const SUBMIT_NOT_OPEN_REASON = 'ส่งเข้าคลังได้เฉพาะกองที่ยังเปิดรับอยู่';

/** A pool may be submitted only when OPEN, unlocked and holding at least one live entry. */
export function canSubmitPool(row: BulkReturnPoolRow): boolean {
	return isPoolEditable(row.pool) && !row.is_empty;
}

/** Why submitting is unavailable, or null when it is allowed. */
export function getSubmitBlockedReason(row: BulkReturnPoolRow): string | null {
	if (canSubmitPool(row)) return null;
	if (row.pool.status !== 'OPEN') return SUBMIT_NOT_OPEN_REASON;
	if (row.pool.lock) return POOL_LOCKED_REASON;
	return SUBMIT_EMPTY_REASON;
}

export interface QtyDisplayRow {
	item_id: string;
	name: string;
	unit: string;
	qty: string;
}

function toQtyDisplayRows(
	summary: readonly BulkReturnPoolItemSummaryRow[],
	catalog: readonly PoolCatalogItem[]
): QtyDisplayRow[] {
	return summary.map(({ item_id, qty }) => ({
		item_id,
		qty,
		...resolveItemDisplay(item_id, catalog)
	}));
}

/** Live per-item totals of an OPEN pool (what a submit would snapshot). */
export function liveSummaryRows(
	row: BulkReturnPoolRow,
	catalog: readonly PoolCatalogItem[]
): QtyDisplayRow[] {
	return toQtyDisplayRows(row.items, catalog);
}

/** The submit snapshot (`items_summary`) of a SUBMITTED / RECEIVED pool. */
export function submittedSummaryRows(
	pool: Pick<BulkReturnPoolV3, 'items_summary'>,
	catalog: readonly PoolCatalogItem[]
): QtyDisplayRow[] {
	return toQtyDisplayRows(pool.items_summary ?? [], catalog);
}

// ---------------------------------------------------------------------------
// Receive form
// ---------------------------------------------------------------------------

export interface ReceiveLine {
	item_id: string;
	/**
	 * The receivable qty ("ยอดที่ส่งมา"): the submit snapshot minus entries already counted in an
	 * older pool. Received is capped at it and a mismatch is `received !== expected_qty`.
	 */
	expected_qty: string;
	/** The submit snapshot qty (>= `expected_qty`). */
	snapshot_qty: string;
	/** Raw text of the input (prefilled with the expected qty). */
	received_qty: string;
	/** '' = none chosen. */
	reason: BulkReturnPoolDiscrepancyReason | '';
	note: string;
}

export interface ReceiveLineErrors {
	received_qty?: string;
	reason?: string;
	note?: string;
}

export interface ReceiveValidation {
	isValid: boolean;
	/** Keyed by item_id; only lines with at least one error are present. */
	lineErrors: Record<string, ReceiveLineErrors>;
	storage?: string;
}

export const STORAGE_REQUIRED_ERROR = 'เลือกจุดเก็บของ';
export const REASON_REQUIRED_ERROR = 'เลือกเหตุผลของส่วนต่าง';
export const NOTE_REQUIRED_ERROR = 'ระบุรายละเอียดเมื่อเลือก "อื่น ๆ"';

export function receiveQtyError(expected: string): string {
	return `กรอกจำนวนเต็มตั้งแต่ 0 ถึง ${expected}`;
}

/**
 * One line per snapshot item, prefilled with the receivable qty. An item missing from
 * `receivableSummary` (or an empty summary) is receivable in full.
 */
export function initReceiveLines(
	itemsSummary: readonly BulkReturnPoolItemSummaryRow[],
	receivableSummary: readonly BulkReturnPoolItemSummaryRow[] = []
): ReceiveLine[] {
	const receivable = new Map(receivableSummary.map((row) => [row.item_id, row.qty]));
	return itemsSummary.map(({ item_id, qty }) => {
		const cap = receivable.get(item_id) ?? qty;
		return {
			item_id,
			expected_qty: cap,
			snapshot_qty: qty,
			received_qty: cap,
			reason: '',
			note: ''
		};
	});
}

/** Qty of the snapshot that is not receivable here (counted in another pool), or null when none. */
export function uncountedGap(line: ReceiveLine): number | null {
	const snapshot = parseWhole(line.snapshot_qty);
	const expected = parseWhole(line.expected_qty);
	if (snapshot === null || expected === null || snapshot <= expected) return null;
	return snapshot - expected;
}

/** Short hint under "ยอดที่ส่งมา" when part of the snapshot was counted in another pool. */
export function uncountedGapHint(gap: number): string {
	return `ไม่นับ ${gap} ชิ้นที่ถูกนับในกองอื่นแล้ว`;
}

/** The typed qty as a whole number, or null when it is not a non-negative integer. */
function parseWhole(raw: string): number | null {
	const text = raw.trim();
	if (!/^\d+$/.test(text)) return null;
	const value = Number(text);
	return Number.isSafeInteger(value) ? value : null;
}

function isWithinExpected(line: ReceiveLine): boolean {
	const received = parseWhole(line.received_qty);
	const expected = parseWhole(line.expected_qty);
	return received !== null && expected !== null && received <= expected;
}

/** A valid integer that differs from the expected qty (needs a reason). */
export function isLineMismatched(line: ReceiveLine): boolean {
	const received = parseWhole(line.received_qty);
	const expected = parseWhole(line.expected_qty);
	return received !== null && expected !== null && received !== expected;
}

export function countMismatchedLines(lines: readonly ReceiveLine[]): number {
	return lines.filter(isLineMismatched).length;
}

export interface ReceiveStorageContext {
	storagePointId: string;
	points: readonly { id: string; name: string }[];
}

export function validateReceiveLines(
	lines: readonly ReceiveLine[],
	storage: ReceiveStorageContext
): ReceiveValidation {
	const lineErrors: Record<string, ReceiveLineErrors> = {};
	for (const line of lines) {
		const errors: ReceiveLineErrors = {};
		if (!isWithinExpected(line)) {
			errors.received_qty = receiveQtyError(line.expected_qty);
		} else if (isLineMismatched(line)) {
			if (line.reason === '') {
				errors.reason = REASON_REQUIRED_ERROR;
			} else if (line.reason === 'other' && line.note.trim() === '') {
				errors.note = NOTE_REQUIRED_ERROR;
			}
		}
		if (Object.keys(errors).length > 0) lineErrors[line.item_id] = errors;
	}
	const storageError = isStoragePointChosen(storage.storagePointId, storage.points)
		? undefined
		: STORAGE_REQUIRED_ERROR;
	return {
		isValid: Object.keys(lineErrors).length === 0 && storageError === undefined,
		lineErrors,
		...(storageError ? { storage: storageError } : {})
	};
}

/**
 * Workflow input from validated lines. Lines received in full of the receivable qty drop reason /
 * note (the workflow records the "counted in another pool" miscount itself); the note is trimmed
 * and a blank one becomes undefined. `point` null = unspecified (main store).
 */
export function buildReceiveInput(
	lines: readonly ReceiveLine[],
	point: { id: string; name: string } | null
): ReceiveBulkReturnPoolInput {
	return {
		items: lines.map((line) => {
			const received_qty = String(parseWhole(line.received_qty) ?? line.received_qty.trim());
			if (!isLineMismatched(line) || line.reason === '') {
				return { item_id: line.item_id, received_qty };
			}
			const note = line.note.trim();
			return {
				item_id: line.item_id,
				received_qty,
				discrepancy_reason: line.reason,
				discrepancy_note: note === '' ? undefined : note
			};
		}),
		storagePoint: point ? { id: point.id, name: point.name } : null
	};
}

/** Sum of the expected / typed-valid received quantities (invalid lines count as 0). */
export function receiveTotals(lines: readonly ReceiveLine[]): {
	expected: number;
	received: number;
} {
	let expected = 0;
	let received = 0;
	for (const line of lines) {
		expected += parseWhole(line.expected_qty) ?? 0;
		received += parseWhole(line.received_qty) ?? 0;
	}
	return { expected, received };
}

// ---------------------------------------------------------------------------
// Receive record (RECEIVED pool, read-only)
// ---------------------------------------------------------------------------

export interface ReceiveRecordRow {
	item_id: string;
	name: string;
	unit: string;
	expected: string;
	received: string;
	/** expected - received (0 when received in full). */
	diff: number;
	reasonLabel: string | null;
	note: string | null;
	mismatched: boolean;
}

export function receiveRecordRows(
	pool: Pick<BulkReturnPoolV3, 'received_items'>,
	catalog: readonly PoolCatalogItem[]
): ReceiveRecordRow[] {
	return (pool.received_items ?? []).map((item) => {
		const display = resolveItemDisplay(item.item_id, catalog);
		const diff = (parseWhole(item.expected_qty) ?? 0) - (parseWhole(item.received_qty) ?? 0);
		return {
			item_id: item.item_id,
			name: display.name,
			unit: display.unit,
			expected: item.expected_qty,
			received: item.received_qty,
			diff,
			reasonLabel: item.discrepancy_reason ? discrepancyReasonLabel(item.discrepancy_reason) : null,
			note: item.discrepancy_note ?? null,
			mismatched: diff !== 0
		};
	});
}

/** Where the stock was received into: the recorded point name, else the main store. */
export function receivedStorageLabel(
	pool: Pick<BulkReturnPoolV3, 'received_storage_zone'>
): string {
	const zone = pool.received_storage_zone?.trim();
	return zone ? zone : DEFAULT_STORAGE_LABEL;
}
