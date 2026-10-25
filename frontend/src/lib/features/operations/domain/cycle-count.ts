import { qtyGt, subQty, qtyIsZero, persistQty } from '$lib/utils/qty';
import type { AuthorContext } from '$lib/db/model';
import { deriveDeterministicLedgerId } from './deterministic-ledger-id';
import {
	lotLocationFields,
	lotStorageKey,
	lotStorageLabel,
	type StoragePointRef
} from './lot-storage';
import {
	ADJUST_NOTE_MAX_LENGTH,
	createAdjustEntry,
	projectLotsByItem,
	StockLotIntegrityError,
	type StockLedger,
	type StockLot
} from './operations';

/**
 * Cycle count (CR-143 §C, #347): walk one storage point, key what is physically on
 * the shelf for every lot, save once. Each lot whose count differs from the system
 * becomes ONE `adjust` row with `adjust_reason: 'count_mismatch'`; lots that match
 * or were left blank write nothing. Pure helpers only — the write itself is
 * `OperationsRepository.applyCycleCount`.
 */

/** Namespace of the deterministic `_id` of a cycle-count row. */
const CYCLE_COUNT_NAMESPACE = 'cycle_count';

/** A lot as it stood when the count started: what the counter compares the shelf against. */
export interface CycleCountLot {
	/** Stable identity inside one count: the physical lot's `lot_ref`. */
	lot_key: string;
	/** The physical lot (its inbound row's `_id`) — a short count is written against it. */
	lot_ref: string;
	item_id: string;
	unit: string;
	/** Storage group key ({@link lotStorageKey}); `''` = unspecified / main store. */
	storage_key: string;
	/** Location + expiry of the lot's inbound row, carried onto a surplus so it lands beside it. */
	lot: StockLot;
	/** When the lot came in — tells apart two lots of one item at the same place and expiry. */
	received_at: string;
	/** System balance at the moment the count started (frozen for the whole walk). */
	system_qty: string;
}

/** One lot of the count plus what the counter keyed (`''` = not counted yet). */
export interface CycleCountEntry extends CycleCountLot {
	counted_qty: string;
}

export type CycleCountState = 'uncounted' | 'invalid' | 'match' | 'over' | 'short';

export interface StorageGroup {
	storage_key: string;
	label: string;
	lots: CycleCountLot[];
}

/**
 * Lots that still hold stock — one entry per physical lot, at the balance the stock table
 * shows (#569). A lot at zero is not on the shelf, so there is nothing to walk past; stock
 * found where the system has none is recorded through the adjust form (`found`).
 */
export function buildCycleCountLots(
	ledger: readonly StockLedger[],
	onIntegrityError?: (itemId: string, error: StockLotIntegrityError) => void
): CycleCountLot[] {
	return projectLotsByItem(ledger, onIntegrityError)
		.filter((lot) => qtyGt(lot.qty, 0))
		.map((lot) => ({
			lot_key: lot.lot_ref,
			lot_ref: lot.lot_ref,
			item_id: lot.item_id,
			unit: lot.unit,
			storage_key: lotStorageKey(lot.lot),
			lot: {
				...lotLocationFields(lot.lot),
				...(lot.lot?.expiry ? { expiry: lot.lot.expiry } : {})
			},
			received_at: lot.received_at,
			system_qty: persistQty(lot.qty)
		}));
}

/** Storage points that hold stock, in the order the counter would walk them (main store first). */
export function groupLotsByStorage(
	lots: readonly CycleCountLot[],
	points: readonly StoragePointRef[] = []
): StorageGroup[] {
	const groups = new Map<string, StorageGroup>();
	for (const lot of lots) {
		let group = groups.get(lot.storage_key);
		if (!group) {
			group = {
				storage_key: lot.storage_key,
				label: lotStorageLabel(lot.lot, points),
				lots: []
			};
			groups.set(lot.storage_key, group);
		}
		group.lots.push(lot);
	}
	return [...groups.values()].sort(
		(a, b) =>
			Number(b.storage_key === '') - Number(a.storage_key === '') ||
			a.label.localeCompare(b.label, 'th')
	);
}

/** A keyed quantity is a non-negative decimal with at most 4 places (the `qty_str` scale). */
function isValidCount(value: string): boolean {
	return /^\d+(\.\d{1,4})?$/.test(value.trim());
}

export function classifyCycleCount(
	entry: Pick<CycleCountEntry, 'system_qty' | 'counted_qty'>
): CycleCountState {
	const counted = entry.counted_qty.trim();
	if (counted === '') return 'uncounted';
	if (!isValidCount(counted)) return 'invalid';
	const diff = subQty(counted, entry.system_qty);
	if (qtyIsZero(diff)) return 'match';
	return qtyGt(diff, 0) ? 'over' : 'short';
}

/** `counted − system` for a counted lot, else `null` (blank / invalid lines have no variance). */
export function cycleCountVariance(
	entry: Pick<CycleCountEntry, 'system_qty' | 'counted_qty'>
): string | null {
	const state = classifyCycleCount(entry);
	if (state === 'uncounted' || state === 'invalid') return null;
	return subQty(entry.counted_qty.trim(), entry.system_qty);
}

export interface CycleCountSummary {
	total: number;
	counted: number;
	match: number;
	mismatched: number;
	uncounted: number;
	invalid: number;
}

export function summarizeCycleCount(entries: readonly CycleCountEntry[]): CycleCountSummary {
	const summary: CycleCountSummary = {
		total: entries.length,
		counted: 0,
		match: 0,
		mismatched: 0,
		uncounted: 0,
		invalid: 0
	};
	for (const entry of entries) {
		const state = classifyCycleCount(entry);
		if (state === 'uncounted') summary.uncounted += 1;
		else if (state === 'invalid') summary.invalid += 1;
		else {
			summary.counted += 1;
			if (state === 'match') summary.match += 1;
			else summary.mismatched += 1;
		}
	}
	return summary;
}

/** One lot that will be written: the signed delta that turns the system qty into the count. */
export interface CycleCountLine {
	lot_key: string;
	/** The counted lot; a short line is written against it (`lot_ref`). */
	lot_ref: string;
	item_id: string;
	unit: string;
	lot: StockLot;
	/** Signed `counted − system`, never zero. */
	qty: string;
}

/** What one save sends: the lines that differ, under one count identity. */
export interface CycleCountSubmission {
	/** Identity of the whole walk — part of every row's `_id`, so a retry cannot double-write. */
	count_id: string;
	note?: string;
	lines: CycleCountLine[];
}

/** Lines that differ from the system. Uncounted, matching and invalid lines write nothing. */
export function planCycleCount(
	entries: readonly CycleCountEntry[],
	count_id: string,
	note?: string
): CycleCountSubmission {
	const lines: CycleCountLine[] = [];
	for (const entry of entries) {
		const variance = cycleCountVariance(entry);
		if (variance === null || qtyIsZero(variance)) continue;
		lines.push({
			lot_key: entry.lot_key,
			lot_ref: entry.lot_ref,
			item_id: entry.item_id,
			unit: entry.unit,
			lot: entry.lot,
			qty: variance
		});
	}
	const trimmed = note?.trim();
	return {
		count_id,
		...(trimmed ? { note: trimmed.slice(0, ADJUST_NOTE_MAX_LENGTH) } : {}),
		lines
	};
}

/**
 * `_id` of the ledger row of one counted lot: deterministic in
 * `(count id, item id, lot key)` so re-sending the same count can never create a
 * second row for it.
 */
export function deriveCycleCountLineId(
	countId: string,
	itemId: string,
	lotKey: string
): Promise<string> {
	return deriveDeterministicLedgerId(CYCLE_COUNT_NAMESPACE, countId, itemId, lotKey);
}

/**
 * The `adjust` rows for a plan: `count_mismatch`, ids index-aligned with `submission.lines`.
 *
 * A short line takes the stock off the counted lot (`lot_ref`) — without it the row would be
 * replayed against whichever lot comes first and could hit stock already taken (#569). A
 * surplus is new stock: the ledger makes every positive row its own lot, so it carries the
 * counted lot's location and expiry instead of its `lot_ref`.
 */
export function createCycleCountEntries(
	submission: CycleCountSubmission,
	ctx: AuthorContext,
	ids: readonly string[]
): StockLedger[] {
	if (ids.length !== submission.lines.length) {
		throw new Error('createCycleCountEntries: ids must line up one-to-one with lines');
	}
	return submission.lines.map((line, index) =>
		createAdjustEntry(
			{
				item_id: line.item_id,
				qty: line.qty,
				unit: line.unit,
				adjust_reason: 'count_mismatch',
				...(submission.note ? { note: submission.note } : {}),
				lot: line.lot,
				...(qtyGt('0', line.qty) ? { lot_ref: line.lot_ref } : {}),
				ref_id: null
			},
			ctx,
			ids[index]
		)
	);
}

export type CycleCountLineState = 'saved' | 'failed';

export interface CycleCountLineResult {
	lot_key: string;
	item_id: string;
	state: CycleCountLineState;
	ledger_id: string;
	/** Why a `failed` line did not land. */
	error?: string;
}

/** Outcome of one `applyCycleCount` call (never thrown for a partial write). */
export interface CycleCountResult {
	lines: CycleCountLineResult[];
	/** Every line is in the ledger. */
	complete: boolean;
}
