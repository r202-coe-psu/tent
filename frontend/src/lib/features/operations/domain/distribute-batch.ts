/**
 * Batch direct issue (#837, CR-143 §A / FR-A9): one withdrawal of several items under one
 * `ref_id` and one destination.
 *
 * Pure: no I/O, no Svelte. The form edits a list of {@link DistributeLineDraft}; this module
 * checks every line against the lot balances, builds the write plan, and folds the result of
 * a (possibly partial) run back into the draft so a retry only touches what is left.
 */

import { defaultIssueUom, qtyToBaseUnit, type PackagingSource } from '$lib/features/catalog';
import { addQty, qtyGt, qtyLte, subQty } from '$lib/utils/qty';
import { distributeInputSchema, type StockLotBalance } from './operations';
import { isLotExpired, rankLotsForIssue, type LotPriorityItem } from './lot-priority';
import { planLotSplit, type LotAllocation, type LotSplitPlan } from './lot-split';
import {
	dailyConsumption,
	daysOfCover,
	groupLotsByItem,
	resolveReorderThreshold,
	type ReorderPolicySource
} from './stock-summary';

/** 'auto' splits across lots in priority order (FR-A7); 'single' issues from the one chosen lot (FR-A10). */
export type DistributeLotMode = { mode: 'auto' } | { mode: 'single'; lot_ref: string };

/**
 * Where a line stands after the runs so far. `distributedQty` is in the item's base unit and
 * counts every row of the line that already landed — those rows are never written again.
 */
export type DistributeLineStatus =
	| { kind: 'pending' }
	| { kind: 'done'; distributedQty: string }
	| { kind: 'failed'; message: string; distributedQty: string };

export interface DistributeLineDraft {
	/** Stable identity of the line (ulid); never reused or renumbered. */
	key: string;
	/** '' = no item chosen yet. */
	item_id: string;
	/** What the user typed, in `unit`; '' until typed. After a partial cut: what is left, in the base unit. */
	qty: string;
	unit: string;
	lot: DistributeLotMode;
	status: DistributeLineStatus;
}

export function emptyDistributeLine(key: string): DistributeLineDraft {
	return {
		key,
		item_id: '',
		qty: '',
		unit: '',
		lot: { mode: 'auto' },
		status: { kind: 'pending' }
	};
}

/** Point a line at another item (or none): unit falls back to the item's issue unit, qty and lot reset. */
export function withLineItem(
	line: DistributeLineDraft,
	item: ({ _id: string } & PackagingSource) | null
): DistributeLineDraft {
	return {
		...emptyDistributeLine(line.key),
		item_id: item?._id ?? '',
		unit: item ? defaultIssueUom(item) : ''
	};
}

/** Base-unit quantity of this line that is already in the ledger. */
export function landedQty(line: Pick<DistributeLineDraft, 'status'>): string {
	return line.status.kind === 'pending' ? '0' : line.status.distributedQty;
}

/** A line with rows in the ledger: its item, destination and history can no longer change. */
export function hasLandedRows(line: Pick<DistributeLineDraft, 'status'>): boolean {
	return qtyGt(landedQty(line), 0);
}

export function parseDistributeNote(
	note: string
): { ok: true; value: string } | { ok: false; message: string } {
	const parsed = distributeInputSchema.shape.note.safeParse(note);
	return parsed.success
		? { ok: true, value: parsed.data }
		: { ok: false, message: parsed.error.issues[0]?.message ?? 'กรุณาระบุปลายทาง / ผู้รับ' };
}

// ---------------------------------------------------------------- check

/** Reorder fields of one item and of its shelter override, as `resolveReorderThreshold` reads them. */
export interface ReorderPolicy {
	item: ReorderPolicySource;
	override: ReorderPolicySource | null;
}

export interface DistributeCheckContext {
	/** Every lot balance of the shelter; ranking and grouping happen here. */
	lots: readonly StockLotBalance[];
	packaging: ReadonlyMap<string, PackagingSource>;
	priorityItems: ReadonlyMap<string, LotPriorityItem>;
	reorder: ReadonlyMap<string, ReorderPolicy>;
	occupancy: number;
	/** Epoch milliseconds. */
	now: number;
}

export interface LowStockWarning {
	/** What stays on hand after this line, base unit. */
	remaining: string;
	threshold: string;
	coverDays: number | null;
}

export type IncompleteReason = 'item' | 'qty' | 'unit' | 'lot';

export type DistributeLineVerdict =
	/** Already written; skipped by the check and by the next run. */
	| { kind: 'done' }
	| { kind: 'incomplete'; missing: IncompleteReason }
	/** The item sits on an earlier line; one line per item. */
	| { kind: 'duplicate' }
	/** Not enough to issue; `requested` and `available` are base-unit. */
	| { kind: 'short'; requested: string; available: string }
	| {
			kind: 'ok';
			/** Base-unit quantity this line will issue. */
			baseQty: string;
			plan: LotSplitPlan;
			lowStock: LowStockWarning | null;
	  };

export interface DistributeBatchCheck {
	/** Index-aligned with the lines. */
	verdicts: DistributeLineVerdict[];
	/** Lines still to write. */
	pendingCount: number;
	/** At least one line is left to write and every such line is `ok`. */
	canSave: boolean;
}

/** Lots of each item in issue order (FR-A5), empty ones dropped, expired ones last. */
export function rankLotsByItem(
	lots: readonly StockLotBalance[],
	priorityItems: ReadonlyMap<string, LotPriorityItem>,
	now: number
): Map<string, StockLotBalance[]> {
	const ranked = new Map<string, StockLotBalance[]>();
	for (const [itemId, group] of groupLotsByItem(lots)) {
		ranked.set(itemId, rankLotsForIssue(group, priorityItems, now));
	}
	return ranked;
}

/**
 * The most one save can issue for this line, base unit: every usable lot in auto mode
 * (expired lots are never issued automatically, FR-A4), the chosen lot in single mode.
 */
export function availableForLine(
	lot: DistributeLotMode,
	rankedLots: readonly StockLotBalance[],
	priorityItems: ReadonlyMap<string, LotPriorityItem>,
	now: number
): string {
	if (lot.mode === 'single') {
		return rankedLots.find((l) => l.lot_ref === lot.lot_ref)?.qty ?? '0';
	}
	return rankedLots
		.filter((l) => !isLotExpired(l, now, priorityItems.get(l.item_id)))
		.reduce((sum, l) => addQty(sum, l.qty), '0');
}

function lowStockFor(
	itemId: string,
	baseQty: string,
	rankedLots: readonly StockLotBalance[],
	ctx: DistributeCheckContext
): LowStockWarning | null {
	const policy = ctx.reorder.get(itemId);
	if (!policy) return null;
	// On hand counts expired lots too, as the stock page does: they are still on the shelf until adjusted out.
	const onHand = rankedLots.reduce((sum, l) => addQty(sum, l.qty), '0');
	const remaining = subQty(onHand, baseQty);
	const threshold = resolveReorderThreshold(ctx.occupancy, policy.item, policy.override);
	if (!threshold || !qtyLte(remaining, threshold)) return null;
	const daily = dailyConsumption(ctx.occupancy, policy.item, policy.override);
	return { remaining, threshold, coverDays: daysOfCover(remaining, daily) };
}

function checkLine(
	line: DistributeLineDraft,
	ctx: DistributeCheckContext,
	rankedByItem: ReadonlyMap<string, StockLotBalance[]>
): DistributeLineVerdict {
	const packaging = ctx.packaging.get(line.item_id);
	if (!packaging) return { kind: 'incomplete', missing: 'item' };

	const qty = line.qty.trim();
	if (qty === '' || !Number.isFinite(Number(qty)) || !qtyGt(qty, 0)) {
		return { kind: 'incomplete', missing: 'qty' };
	}
	let baseQty: string;
	try {
		baseQty = qtyToBaseUnit(qty, line.unit, packaging);
	} catch {
		return { kind: 'incomplete', missing: 'unit' };
	}
	// Quantities keep 4 decimals, so a tiny packaging quantity can round to nothing.
	if (!qtyGt(baseQty, 0)) return { kind: 'incomplete', missing: 'qty' };

	const ranked = rankedByItem.get(line.item_id) ?? [];
	let plan: LotSplitPlan;
	if (line.lot.mode === 'single') {
		const { lot_ref } = line.lot;
		const lot = ranked.find((l) => l.lot_ref === lot_ref);
		if (!lot) return { kind: 'incomplete', missing: 'lot' };
		if (qtyGt(baseQty, lot.qty)) {
			return { kind: 'short', requested: baseQty, available: lot.qty };
		}
		plan = {
			allocations: [{ lot, lot_ref: lot.lot_ref, qty: baseQty }],
			planned: baseQty,
			shortfall: '0',
			available: lot.qty,
			skippedExpired: [],
			complete: true
		};
	} else {
		plan = planLotSplit(ranked, baseQty, ctx.now, ctx.priorityItems);
		if (!plan.complete) {
			return { kind: 'short', requested: baseQty, available: plan.available };
		}
	}
	return { kind: 'ok', baseQty, plan, lowStock: lowStockFor(line.item_id, baseQty, ranked, ctx) };
}

/**
 * Verdict per line, from the current lot balances. A line whose item already appears on an
 * earlier line is `duplicate` (done lines count as earlier lines), so the same item is never
 * issued twice under one ticket. Because items never repeat, lines do not compete for the
 * same lots and can be checked independently.
 */
export function checkDistributeBatch(
	lines: readonly DistributeLineDraft[],
	ctx: DistributeCheckContext
): DistributeBatchCheck {
	const rankedByItem = rankLotsByItem(ctx.lots, ctx.priorityItems, ctx.now);
	const seen = new Set<string>();
	const verdicts = lines.map((line): DistributeLineVerdict => {
		const duplicate = line.item_id !== '' && seen.has(line.item_id);
		if (line.item_id) seen.add(line.item_id);
		if (line.status.kind === 'done') return { kind: 'done' };
		if (!line.item_id) return { kind: 'incomplete', missing: 'item' };
		if (duplicate) return { kind: 'duplicate' };
		return checkLine(line, ctx, rankedByItem);
	});
	const pending = verdicts.filter((v) => v.kind !== 'done');
	return {
		verdicts,
		pendingCount: pending.length,
		canSave: pending.length > 0 && pending.every((v) => v.kind === 'ok')
	};
}

// ---------------------------------------------------------------- write plan and run result

/** One line ready to write: its rows, base-unit, in issue order. */
export interface BatchLinePlan {
	key: string;
	item_id: string;
	allocations: readonly LotAllocation[];
}

/** The lines the next run writes: every `ok` line, in display order. */
export function planBatchWrites(
	lines: readonly DistributeLineDraft[],
	check: DistributeBatchCheck
): BatchLinePlan[] {
	const plans: BatchLinePlan[] = [];
	lines.forEach((line, index) => {
		const verdict = check.verdicts[index];
		if (verdict?.kind === 'ok') {
			plans.push({ key: line.key, item_id: line.item_id, allocations: verdict.plan.allocations });
		}
	});
	return plans;
}

/** One line of the batch summary shown before saving. Quantities in `allocations`/`landed` are base-unit. */
export type BatchSummaryEntry =
	| {
			kind: 'ready';
			key: string;
			item_id: string;
			/** As typed, in `unit`. */
			qty: string;
			unit: string;
			baseQty: string;
			/** Already in the ledger from an earlier partial run (`0` when none). */
			landed: string;
			allocations: readonly LotAllocation[];
	  }
	| { kind: 'done'; key: string; item_id: string; landed: string };

export interface BatchSummary {
	/** Display order; lines that are not ready yet (incomplete, short, duplicate) are left out. */
	entries: BatchSummaryEntry[];
	/** Lines the next save writes. */
	readyCount: number;
	/** Ledger rows the next save writes, one per lot cut. */
	rowCount: number;
}

/** What the batch takes and from which lots, across every line, for the summary under the lines. */
export function summarizeBatch(
	lines: readonly DistributeLineDraft[],
	check: DistributeBatchCheck
): BatchSummary {
	const entries: BatchSummaryEntry[] = [];
	lines.forEach((line, index) => {
		const verdict = check.verdicts[index];
		if (verdict?.kind === 'done') {
			entries.push({ kind: 'done', key: line.key, item_id: line.item_id, landed: landedQty(line) });
		} else if (verdict?.kind === 'ok') {
			entries.push({
				kind: 'ready',
				key: line.key,
				item_id: line.item_id,
				qty: line.qty,
				unit: line.unit,
				baseQty: verdict.baseQty,
				landed: landedQty(line),
				allocations: verdict.plan.allocations
			});
		}
	});
	const ready = entries.filter((entry) => entry.kind === 'ready');
	return {
		entries,
		readyCount: ready.length,
		rowCount: ready.reduce((sum, entry) => sum + entry.allocations.length, 0)
	};
}

/** What one run did to one line. Quantities are base-unit. */
export type DistributeLineOutcome =
	| { kind: 'done'; key: string; distributedQty: string }
	/** Some rows landed, a later one failed; `remainingQty` (in `unit`) was not cut. */
	| {
			kind: 'partial';
			key: string;
			distributedQty: string;
			remainingQty: string;
			unit: string;
			message: string;
	  }
	/** The first row failed: nothing of this line was cut. */
	| { kind: 'failed'; key: string; message: string }
	/** An earlier line failed, so the run stopped before this one. */
	| { kind: 'not_attempted'; key: string };

/**
 * Fold a run into the draft. Done lines lock; a partly cut line keeps what landed and asks only
 * for the rest, in the base unit so the retry cuts exactly what is missing; a line that
 * was not attempted is left as it was. Lines the run did not mention are untouched.
 */
export function applyBatchRun(
	lines: readonly DistributeLineDraft[],
	outcomes: readonly DistributeLineOutcome[]
): DistributeLineDraft[] {
	const byKey = new Map(outcomes.map((o) => [o.key, o]));
	return lines.map((line) => {
		const outcome = byKey.get(line.key);
		if (!outcome || outcome.kind === 'not_attempted') return line;
		const before = landedQty(line);
		switch (outcome.kind) {
			case 'done':
				return {
					...line,
					status: { kind: 'done', distributedQty: addQty(before, outcome.distributedQty) }
				};
			case 'partial':
				return {
					...line,
					qty: outcome.remainingQty,
					unit: outcome.unit,
					status: {
						kind: 'failed',
						message: outcome.message,
						distributedQty: addQty(before, outcome.distributedQty)
					}
				};
			case 'failed':
				return {
					...line,
					status: { kind: 'failed', message: outcome.message, distributedQty: before }
				};
		}
	});
}
