/**
 * Weighted lot priority for issuing stock (CR-143 §A, FR-A1–A6).
 *
 * Pure: no I/O, no Svelte. Lower score = use first, except that lots with a
 * real, near expiry always go first (the "urgent group"). Every place that picks
 * a lot to issue from — the stock page and distribution — ranks through
 * {@link rankLotsForIssue} (FR-A5).
 *
 * NOT used by `projectStockLotBalances`: that replays legacy outbound rows with
 * the old FEFO/FIFO comparator and must keep doing so, or historical per-lot
 * balances would change.
 */

import { qtyGt } from '$lib/utils/qty';
import type { StockLotBalance } from './operations';

const MS_DAY = 86_400_000;

/** Weight of days until expiry in the score (FR-A2). */
export const W_EXPIRY = 1;
/** Weight of days in stock in the score (FR-A2). */
export const W_AGE = 0.5;
/** A lot with real data and `daysLeft` at or below this goes first (FR-A2, FR-A3). */
export const URGENT_DAYS = 7;
/** Assumed days of life for a lot with no expiry and no shelf life, by storage type (FR-A2). */
export const HORIZON_DAYS: Readonly<Record<string, number>> = {
	DRY: 365,
	CHILLED: 7,
	FROZEN: 90,
	CONTROLLED_MED: 365
};
/** Horizon for an item with no / unknown storage_type. */
export const DEFAULT_HORIZON_DAYS = 365;

/** The item-master fields the ranking reads. */
export interface LotPriorityItem {
	storage_type?: string;
	shelf_life_days?: number;
}

/** The lot fields the ranking reads. */
export type LotPriorityLot = Pick<StockLotBalance, 'lot_ref' | 'received_at' | 'lot'>;

/** Where `daysLeft` came from; only `expiry` and `shelf_life` are real data (FR-A3a). */
export type DaysLeftSource = 'expiry' | 'shelf_life' | 'horizon';

export interface LotScore {
	ageDays: number;
	daysLeft: number;
	daysLeftSource: DaysLeftSource;
	score: number;
	/** `0 < daysLeft <= URGENT_DAYS` from real data (never from HORIZON) (FR-A3a, FR-A4b). */
	isUrgent: boolean;
	/** `lot.expiry <= now` (FR-A4), or no expiry and `shelf_life_days` already used up (FR-A4a). */
	isExpired: boolean;
}

function parseMs(value: string | undefined): number {
	if (!value) return NaN;
	return Date.parse(value);
}

/**
 * Whether a lot must not be picked automatically (FR-A4, FR-A4a): `lot.expiry <= now`, or —
 * with no usable expiry — `shelf_life_days` already used up. A lot past only the storage-type
 * HORIZON is NOT expired (FR-A4c). Pass `item` to apply the shelf-life rule; without it only
 * `lot.expiry` is checked.
 */
export function isLotExpired(
	lot: Pick<StockLotBalance, 'lot'> & { received_at?: string },
	now: number,
	item?: LotPriorityItem
): boolean {
	const expiry = parseMs(lot.lot?.expiry);
	if (!Number.isNaN(expiry)) return expiry <= now;
	if (item === undefined || !lot.received_at) return false;
	const s = scoreLot({ lot: lot.lot, received_at: lot.received_at }, item, now);
	return s.daysLeftSource === 'shelf_life' && s.daysLeft <= 0;
}

/** FR-A1: score one lot. `now` is epoch milliseconds. */
export function scoreLot(
	lot: Pick<StockLotBalance, 'received_at' | 'lot'>,
	item: LotPriorityItem | undefined,
	now: number
): LotScore {
	const clock = parseMs(lot.lot?.produced_at);
	const start = Number.isNaN(clock) ? parseMs(lot.received_at) : clock;
	const ageDays = Number.isNaN(start) ? 0 : (now - start) / MS_DAY;

	const expiry = parseMs(lot.lot?.expiry);
	let daysLeft: number;
	let daysLeftSource: DaysLeftSource;
	if (!Number.isNaN(expiry)) {
		daysLeft = (expiry - now) / MS_DAY;
		daysLeftSource = 'expiry';
	} else if (typeof item?.shelf_life_days === 'number' && Number.isFinite(item.shelf_life_days)) {
		daysLeft = item.shelf_life_days - ageDays;
		daysLeftSource = 'shelf_life';
	} else {
		const horizon =
			(item?.storage_type ? HORIZON_DAYS[item.storage_type] : undefined) ?? DEFAULT_HORIZON_DAYS;
		daysLeft = horizon - ageDays;
		daysLeftSource = 'horizon';
	}

	return {
		ageDays,
		daysLeft,
		daysLeftSource,
		score: W_EXPIRY * daysLeft - W_AGE * ageDays,
		isUrgent: daysLeftSource !== 'horizon' && daysLeft > 0 && daysLeft <= URGENT_DAYS,
		isExpired:
			daysLeftSource === 'expiry' ? daysLeft <= 0 : daysLeftSource === 'shelf_life' && daysLeft <= 0
	};
}

/** Index item-master-shaped rows (only the ranking fields are read) by `_id`. */
export function toLotPriorityItems(
	items: Iterable<{ _id: string } & LotPriorityItem>
): Map<string, LotPriorityItem> {
	const byId = new Map<string, LotPriorityItem>();
	for (const item of items) {
		byId.set(item._id, { storage_type: item.storage_type, shelf_life_days: item.shelf_life_days });
	}
	return byId;
}

export interface RankLotsOptions {
	/** Drop expired lots entirely — the auto-issue plan (FR-A4, FR-A7). Default: keep them, last. */
	excludeExpired?: boolean;
}

/**
 * FR-A3: ranked order for issuing. Lots with no quantity left are dropped.
 * 1. Urgent group, by `daysLeft` ascending.
 * 2. The rest, by `score` ascending.
 * 3. Ties: older `received_at`, then `lot_ref`.
 * Expired lots (FR-A4) are never picked automatically, so they sort after every
 * usable lot (or are dropped with `excludeExpired`) — they are shown, not issued.
 */
export function rankLotsForIssue<
	T extends LotPriorityLot & Pick<StockLotBalance, 'item_id' | 'qty'>
>(
	lots: readonly T[],
	itemsById: ReadonlyMap<string, LotPriorityItem> | undefined,
	now: number,
	options: RankLotsOptions = {}
): T[] {
	const scored = lots
		.filter((lot) => qtyGt(lot.qty, 0))
		.map((lot) => ({ lot, s: scoreLot(lot, itemsById?.get(lot.item_id), now) }))
		.filter(({ s }) => !(options.excludeExpired && s.isExpired));

	scored.sort((a, b) => {
		if (a.s.isExpired !== b.s.isExpired) return a.s.isExpired ? 1 : -1;
		if (a.s.isUrgent !== b.s.isUrgent) return a.s.isUrgent ? -1 : 1;
		const primary = a.s.isUrgent ? a.s.daysLeft - b.s.daysLeft : a.s.score - b.s.score;
		if (primary !== 0) return primary;
		if (a.lot.received_at !== b.lot.received_at) {
			return a.lot.received_at.localeCompare(b.lot.received_at);
		}
		return a.lot.lot_ref.localeCompare(b.lot.lot_ref);
	});
	return scored.map(({ lot }) => lot);
}

/** FR-A6: the short Thai reason a lot sits where it does in the issue order. */
export function lotPriorityReason(
	lot: Pick<StockLotBalance, 'received_at' | 'lot'>,
	item: LotPriorityItem | undefined,
	now: number
): string {
	const s = scoreLot(lot, item, now);
	if (s.isExpired) return 'หมดอายุแล้ว — ปรับยอดออก';

	// "In stock" counts from receipt; `s.ageDays` may run from `produced_at` instead.
	const receivedMs = parseMs(lot.received_at);
	const inStockDays = Number.isNaN(receivedMs)
		? 0
		: Math.max(0, Math.floor((now - receivedMs) / MS_DAY));
	const inStock = inStockDays >= 1 ? `อยู่ในคลัง ${inStockDays} วัน` : null;
	// Same raw value `isUrgent` uses; shown rounded up so 0 < daysLeft < 1 reads "1 วัน".
	const daysLeft = Math.ceil(s.daysLeft);

	if (s.daysLeftSource === 'expiry') {
		const left = `หมดอายุอีก ${daysLeft} วัน`;
		if (s.isUrgent) return `${left} (เร่งด่วน)`;
		return inStock ? `${left} · ${inStock}` : left;
	}
	if (s.daysLeftSource === 'shelf_life') {
		const left = `อายุเก็บรักษาเหลือ ${daysLeft} วัน`;
		if (s.isUrgent) return `${left} (เร่งด่วน)`;
		return inStock ? `${left} · ${inStock}` : left;
	}
	return inStock ?? 'เพิ่งรับเข้า';
}
