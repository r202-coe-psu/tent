import { qtyGt } from '$lib/utils/qty';
import { formatThaiShortDate } from '$lib/utils/date';
import { formatTimeUntilExpiry } from '../../domain/lot-age';
import {
	stockUrgencyRank,
	type StockExpiryState,
	type StockQtyStatus
} from '../../domain/stock-summary';

/** A card / filter value: which kind of "needs attention" row to show. */
export type StockStatusFilter = 'expired' | 'empty' | 'low' | 'expiring';

export type StockSort = 'urgency' | 'name' | 'qty';

export type StockBadgeTone = 'critical' | 'warning' | 'ok';

/** What the view logic needs to know about one stock row. */
export interface StockRowBase {
	_id: string;
	name: string;
	category: string;
	qtyOnHand: string;
	status: StockQtyStatus;
	expiryState: StockExpiryState;
	earliestExpiry: string | null;
	/** Distinct storage keys of lots still holding stock ('' = unspecified). */
	storageKeys: string[];
	/** True when this shelter has no ledger row for the item — catalog-only. */
	neverReceived: boolean;
}

/** A row as the table and cards render it — display strings resolved by the orchestrator. */
export interface StockDisplayRow extends StockRowBase {
	categoryLabel: string;
	unitLabel: string;
	reorderThreshold: string | null;
	/** Days the on-hand stock lasts at the configured daily use; null = unknown. */
	coverDays: number | null;
	/** Lots still holding stock. */
	lotCount: number;
	/** First storage point plus a "+N" count, or null when unspecified. */
	locationLabel: string | null;
}

export interface StockFilterState {
	q: string;
	cat: string;
	loc: string;
	status: StockStatusFilter | 'all';
	/** Include catalog items this shelter never received. */
	all: boolean;
}

export type AttentionCounts = Record<StockStatusFilter, number>;

/** Rows the page shows by default: catalog-only items are hidden unless `all`. */
export function visibleRows<T extends StockRowBase>(rows: readonly T[], all: boolean): T[] {
	return all ? [...rows] : rows.filter((r) => !r.neverReceived);
}

/** How many catalog-only items the default view hides. */
export function hiddenCatalogCount(rows: readonly StockRowBase[]): number {
	return rows.filter((r) => r.neverReceived).length;
}

/**
 * Counts for the four attention cards. `expired` and `expiring` are exclusive;
 * `empty` and `low` are exclusive; an expiry state can overlap a qty status.
 */
export function attentionCounts(rows: readonly StockRowBase[]): AttentionCounts {
	const counts: AttentionCounts = { expired: 0, empty: 0, low: 0, expiring: 0 };
	for (const r of rows) {
		if (r.expiryState === 'expired') counts.expired += 1;
		else if (r.expiryState === 'expiring') counts.expiring += 1;
		if (r.status === 'empty') counts.empty += 1;
		else if (r.status === 'low') counts.low += 1;
	}
	return counts;
}

function matchesStatus(row: StockRowBase, status: StockStatusFilter): boolean {
	switch (status) {
		case 'expired':
			return row.expiryState === 'expired';
		case 'expiring':
			return row.expiryState === 'expiring';
		case 'empty':
			return row.status === 'empty';
		case 'low':
			return row.status === 'low';
	}
}

/** Apply search, category, location, status and the catalog-only switch. */
export function filterRows<T extends StockRowBase>(
	rows: readonly T[],
	filter: StockFilterState
): T[] {
	const q = filter.q.toLowerCase().trim();
	return visibleRows(rows, filter.all).filter((r) => {
		if (q && !r.name.toLowerCase().includes(q) && !r._id.toLowerCase().includes(q)) return false;
		if (filter.cat !== 'all' && r.category !== filter.cat) return false;
		if (filter.loc !== 'all' && !r.storageKeys.includes(filter.loc)) return false;
		if (filter.status !== 'all' && !matchesStatus(r, filter.status)) return false;
		return true;
	});
}

const byName = (a: StockRowBase, b: StockRowBase) => a.name.localeCompare(b.name, 'th');

function byEarliestExpiry(a: StockRowBase, b: StockRowBase): number {
	if (a.earliestExpiry === b.earliestExpiry) return 0;
	if (a.earliestExpiry === null) return 1;
	if (b.earliestExpiry === null) return -1;
	return Date.parse(a.earliestExpiry) - Date.parse(b.earliestExpiry);
}

/** Sort a copy. `urgency` = rank, then earliest expiry, then name; `qty` = least first. */
export function sortRows<T extends StockRowBase>(rows: readonly T[], sort: StockSort): T[] {
	const copy = [...rows];
	switch (sort) {
		case 'name':
			return copy.sort(byName);
		case 'qty':
			return copy.sort(
				(a, b) =>
					(qtyGt(a.qtyOnHand, b.qtyOnHand) ? 1 : qtyGt(b.qtyOnHand, a.qtyOnHand) ? -1 : 0) ||
					byName(a, b)
			);
		case 'urgency':
			return copy.sort(
				(a, b) =>
					stockUrgencyRank(a.status, a.expiryState) - stockUrgencyRank(b.status, b.expiryState) ||
					byEarliestExpiry(a, b) ||
					byName(a, b)
			);
	}
}

export function totalPages(count: number, perPage: number): number {
	return Math.max(1, Math.ceil(count / perPage));
}

/** Clamp a 1-based page into range for `count` rows. */
export function clampPage(page: number, count: number, perPage: number): number {
	return Math.min(Math.max(1, Math.trunc(page) || 1), totalPages(count, perPage));
}

export function pageSlice<T>(rows: readonly T[], page: number, perPage: number): T[] {
	const p = clampPage(page, rows.length, perPage);
	return rows.slice((p - 1) * perPage, p * perPage);
}

export interface StockBadge {
	label: string;
	tone: StockBadgeTone;
}

/**
 * Status badges in urgency order. At most two: an expiry badge and a qty badge
 * can both apply (e.g. expired milk that is also below its threshold).
 */
export function statusBadges(row: Pick<StockRowBase, 'status' | 'expiryState'>): StockBadge[] {
	const badges: StockBadge[] = [];
	if (row.expiryState === 'expired') badges.push({ label: 'หมดอายุ', tone: 'critical' });
	if (row.status === 'empty') badges.push({ label: 'หมด', tone: 'critical' });
	else if (row.status === 'low') badges.push({ label: 'ใกล้หมด', tone: 'warning' });
	if (row.expiryState === 'expiring') badges.push({ label: 'ใกล้หมดอายุ', tone: 'warning' });
	return badges.length > 0 ? badges : [{ label: 'ปกติ', tone: 'ok' }];
}

export interface ExpiryLabel {
	/** "—" when no remaining lot has an expiry. */
	text: string;
	/** Relative clock, e.g. "หมดแล้ว 1 วัน" or "2 วัน". */
	relative: string | null;
	tone: 'critical' | 'warning' | 'muted' | 'default';
}

/** Earliest-expiry cell: Buddhist-era short date plus a countdown when it matters. */
export function expiryLabel(
	earliestExpiry: string | null,
	expiryState: StockExpiryState,
	now: number = Date.now()
): ExpiryLabel {
	if (!earliestExpiry) return { text: '—', relative: null, tone: 'muted' };
	const text = formatThaiShortDate(earliestExpiry);
	if (expiryState === 'expired') {
		return { text, relative: formatTimeUntilExpiry(earliestExpiry, now), tone: 'critical' };
	}
	if (expiryState === 'expiring') {
		const left = formatTimeUntilExpiry(earliestExpiry, now);
		return { text, relative: left ? `อีก ${left}` : null, tone: 'warning' };
	}
	return { text, relative: null, tone: 'default' };
}
