/**
 * Pure lot-age clocks for stock UX — in-stock age, time since produced, time until expiry.
 * No I/O; durations format as short Thai phrases (`1 วัน 5 ชม.`, `เพิ่งเข้า`, …).
 */

import { qtyGt } from '$lib/utils/qty';
import type { StockLot, StockLotBalance } from './operations';

const MS_MINUTE = 60_000;
const MS_HOUR = 60 * MS_MINUTE;
const MS_DAY = 24 * MS_HOUR;

/** Format a non-negative duration for Thai staff UI. */
export function formatThaiDuration(ms: number): string {
	const abs = Math.abs(ms);
	if (abs < 2 * MS_MINUTE) return 'เพิ่งเข้า';

	const days = Math.floor(abs / MS_DAY);
	const hours = Math.floor((abs % MS_DAY) / MS_HOUR);
	const minutes = Math.floor((abs % MS_HOUR) / MS_MINUTE);

	if (days >= 1) {
		if (hours > 0) return `${days} วัน ${hours} ชม.`;
		return `${days} วัน`;
	}
	if (hours >= 1) {
		if (minutes > 0) return `${hours} ชม. ${minutes} นาที`;
		return `${hours} ชม.`;
	}
	return `${minutes} นาที`;
}

/** Milliseconds the lot has been in stock (received_at → now). Negative if clock skew. */
export function ageInStockMs(receivedAt: string, now: number = Date.now()): number {
	const t = Date.parse(receivedAt);
	if (Number.isNaN(t)) return NaN;
	return now - t;
}

/** Milliseconds since production. Negative if produced_at is in the future. */
export function timeSinceProducedMs(producedAt: string, now: number = Date.now()): number {
	const t = Date.parse(producedAt);
	if (Number.isNaN(t)) return NaN;
	return now - t;
}

/**
 * Milliseconds until expiry. Negative = already expired.
 * Returns NaN when expiry is missing/invalid.
 */
export function timeUntilExpiryMs(expiry: string, now: number = Date.now()): number {
	const t = Date.parse(expiry);
	if (Number.isNaN(t)) return NaN;
	return t - now;
}

export function formatAgeInStock(receivedAt: string, now: number = Date.now()): string | null {
	const ms = ageInStockMs(receivedAt, now);
	if (!Number.isFinite(ms) || ms < 0) return null;
	return formatThaiDuration(ms);
}

export function formatTimeSinceProduced(
	producedAt: string,
	now: number = Date.now()
): string | null {
	const ms = timeSinceProducedMs(producedAt, now);
	if (!Number.isFinite(ms) || ms < 0) return null;
	return formatThaiDuration(ms);
}

export function formatTimeUntilExpiry(expiry: string, now: number = Date.now()): string | null {
	const ms = timeUntilExpiryMs(expiry, now);
	if (!Number.isFinite(ms)) return null;
	if (ms < 0) return `หมดแล้ว ${formatThaiDuration(ms)}`;
	return formatThaiDuration(ms);
}

export type ItemLotAgeSummary = {
	/** Oldest remaining lot's time in stock, formatted. */
	inStock?: string;
	/** Nearest remaining expiry countdown, formatted. */
	untilExpiry?: string;
	/** Oldest remaining produced_at age, formatted. */
	sinceProduced?: string;
};

/**
 * Derive a short multi-clock summary for an item from remaining lot balances.
 * Missing clocks are omitted (no produced_at / no expiry / no inbound → no line).
 */
export function summarizeItemLotAge(
	lots: readonly StockLotBalance[],
	now: number = Date.now()
): ItemLotAgeSummary {
	const remaining = lots.filter((l) => qtyGt(l.qty, 0));
	if (remaining.length === 0) return {};

	let oldestReceived: string | undefined;
	let nearestExpiry: string | undefined;
	let oldestProduced: string | undefined;

	for (const lot of remaining) {
		if (!oldestReceived || Date.parse(lot.received_at) < Date.parse(oldestReceived)) {
			oldestReceived = lot.received_at;
		}
		const expiry = lot.lot?.expiry;
		if (expiry) {
			if (!nearestExpiry || Date.parse(expiry) < Date.parse(nearestExpiry)) {
				nearestExpiry = expiry;
			}
		}
		const produced = lot.lot?.produced_at;
		if (produced) {
			if (!oldestProduced || Date.parse(produced) < Date.parse(oldestProduced)) {
				oldestProduced = produced;
			}
		}
	}

	const summary: ItemLotAgeSummary = {};
	if (oldestReceived) {
		const s = formatAgeInStock(oldestReceived, now);
		if (s) summary.inStock = s;
	}
	if (nearestExpiry) {
		const s = formatTimeUntilExpiry(nearestExpiry, now);
		if (s) summary.untilExpiry = s;
	}
	if (oldestProduced) {
		const s = formatTimeSinceProduced(oldestProduced, now);
		if (s) summary.sinceProduced = s;
	}
	return summary;
}

/** One-line Thai label for a lot picker's secondary clocks. */
export function formatLotClockLine(
	lot: { received_at: string; lot?: StockLot },
	now: number = Date.now()
): string {
	const parts: string[] = [];
	const inStock = formatAgeInStock(lot.received_at, now);
	if (inStock) parts.push(`ในคลัง ${inStock}`);
	const produced = lot.lot?.produced_at ? formatTimeSinceProduced(lot.lot.produced_at, now) : null;
	if (produced) parts.push(`จากผลิต ${produced}`);
	const until = lot.lot?.expiry ? formatTimeUntilExpiry(lot.lot.expiry, now) : null;
	if (until) {
		parts.push(until.startsWith('หมดแล้ว') ? until : `หมดอายุใน ${until}`);
	}
	return parts.join(' · ');
}

/** Join summary clocks for a stock row/card secondary line. */
export function formatItemAgeLine(summary: ItemLotAgeSummary): string {
	const parts: string[] = [];
	if (summary.inStock) parts.push(`ในคลัง ${summary.inStock}`);
	if (summary.untilExpiry) {
		parts.push(
			summary.untilExpiry.startsWith('หมดแล้ว')
				? summary.untilExpiry
				: `หมดอายุใน ${summary.untilExpiry}`
		);
	}
	if (summary.sinceProduced) parts.push(`จากผลิต ${summary.sinceProduced}`);
	return parts.join(' · ');
}
