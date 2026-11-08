import { parseQty, qtyGt, qtyLte } from '$lib/utils/qty';

/** Visual tone of the "remaining / threshold" bar. */
export type StockBarTone = 'critical' | 'warning' | 'ok' | 'neutral';

export interface StockBarFill {
	/** Fill width, 0–100. */
	pct: number;
	/** Position of the reorder-threshold tick, or null when the item has no threshold. */
	tickPct: number | null;
	tone: StockBarTone;
}

/** The tick sits mid-track, so the track maximum is twice the reorder threshold. */
const TICK_PCT = 50;

/**
 * Fill of the "remaining / threshold" bar. Stock at the threshold fills half
 * the track; twice the threshold (or more) fills it.
 */
export function stockBarFill(onHand: string, threshold: string | null): StockBarFill {
	if (qtyLte(onHand, 0)) {
		return {
			pct: 0,
			tickPct: threshold !== null && qtyGt(threshold, 0) ? TICK_PCT : null,
			tone: 'critical'
		};
	}
	if (threshold === null || qtyLte(threshold, 0)) {
		return { pct: 100, tickPct: null, tone: 'neutral' };
	}
	const raw = parseQty(onHand).div(parseQty(threshold).mul(2)).mul(100);
	const pct = Math.min(100, raw.toDecimalPlaces(1).toNumber());
	return { pct, tickPct: TICK_PCT, tone: qtyLte(onHand, threshold) ? 'warning' : 'ok' };
}

/**
 * Caption under the bar: "เกณฑ์ 40 กล่อง · พอ ~0.8 วัน". `coverDays` is omitted
 * when unknown or when nothing is left.
 */
export function formatThresholdLine(
	threshold: string | null,
	unitLabel: string,
	coverDays: number | null
): string {
	if (threshold === null) return 'ไม่มีเกณฑ์';
	const base = `เกณฑ์ ${threshold} ${unitLabel}`.trim();
	return coverDays !== null && coverDays > 0 ? `${base} · พอ ~${coverDays} วัน` : base;
}

export interface StockBarSegments extends StockBarFill {
	/** Width of the incoming segment, 0–100, drawn right after the in-stock one (#1153). */
	incomingPct: number;
}

/**
 * Bar with an incoming segment. The in-stock part, tick and tone are exactly {@link stockBarFill}
 * of the in-stock qty (so ในคลัง 0 + กำลังมา 100 stays red); incoming is scaled on the same track
 * (twice the threshold) and clipped to the room left. Without a usable threshold the track has no
 * scale, so the two parts split it in proportion.
 */
export function stockBarSegments(
	onHand: string,
	incoming: string,
	threshold: string | null
): StockBarSegments {
	const fill = stockBarFill(onHand, threshold);
	if (!qtyGt(incoming, 0)) return { ...fill, incomingPct: 0 };
	if (threshold === null || qtyLte(threshold, 0)) {
		const inStock = qtyGt(onHand, 0) ? parseQty(onHand) : parseQty(0);
		const total = inStock.plus(parseQty(incoming));
		const pct = inStock.div(total).mul(100).toDecimalPlaces(1).toNumber();
		return { ...fill, pct, incomingPct: Math.round((100 - pct) * 10) / 10 };
	}
	const raw = parseQty(incoming).div(parseQty(threshold).mul(2)).mul(100).toDecimalPlaces(1);
	const room = Math.round((100 - fill.pct) * 10) / 10;
	return { ...fill, incomingPct: Math.min(room, raw.toNumber()) };
}
