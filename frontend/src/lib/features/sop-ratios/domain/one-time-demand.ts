import Decimal from 'decimal.js';
import { isLotExpired, type StockLotBalance } from '$lib/features/operations';
import { addQty, parseQty, persistQty, qtyGt, qtyGte, subQty } from '$lib/utils/qty';

/**
 * Demand vs stock for one-time items (`distribution_type = one_time`), per the draft CR
 * `draft-one-time-item-demand` (#1190). Pure: the people base (`countShelterPeople`, CR-223),
 * lot balances and reservation claims arrive as inputs. Quantities are qty_str / Decimal only.
 */

/** The item_master fields this calculation reads. */
export interface OneTimeDemandItem {
	_id: string;
	name: string;
	base_unit?: string;
	unit?: string;
	distribution_type?: string;
	qty_per_person?: number | null;
	deactivated?: boolean;
	merged_into?: string;
	storage_type?: string;
	shelf_life_days?: number;
}

/** A projected physical lot (`projectStockLotBalances`). */
export type OneTimeDemandLot = StockLotBalance;

/** One pending claim of a `stock_lot_reservation` doc. */
export interface OneTimeDemandReservation {
	item_id: string;
	lot_ref: string;
	qty: string;
}

export type OneTimeDemandStatus = 'enough' | 'short';

export interface OneTimeDemandRow {
	itemId: string;
	name: string;
	unit: string;
	/** people × qty_per_person (qty_str). */
	demand: string;
	/** Non-expired lot balance − active reservations, floored at 0 (qty_str). */
	available: string;
	/** max(0, demand − available) (qty_str). */
	shortfall: string;
	/** available ÷ demand × 100, two decimals; null when demand is 0. */
	coverage: string | null;
	status: OneTimeDemandStatus;
	/** `qty_per_person` was not set, so 1 was used. */
	qtyPerPersonMissing: boolean;
}

export interface BuildOneTimeDemandInput {
	items: readonly OneTimeDemandItem[];
	/** `countShelterPeople` total for the shelter. */
	people: number;
	lots: readonly OneTimeDemandLot[];
	reservations: readonly OneTimeDemandReservation[];
	/** Epoch ms; lot expiry is judged against it. */
	now: number;
}

const ZERO = '0';

function isActiveOneTime(item: OneTimeDemandItem): boolean {
	return item.distribution_type === 'one_time' && !item.deactivated && !item.merged_into;
}

export function buildOneTimeDemandRows(input: BuildOneTimeDemandInput): OneTimeDemandRow[] {
	const { people, now } = input;
	const lotsByItem = new Map<string, OneTimeDemandLot[]>();
	for (const lot of input.lots) {
		const list = lotsByItem.get(lot.item_id);
		if (list) list.push(lot);
		else lotsByItem.set(lot.item_id, [lot]);
	}
	const reservationsByLot = new Map<string, string>();
	for (const claim of input.reservations) {
		reservationsByLot.set(
			claim.lot_ref,
			addQty(reservationsByLot.get(claim.lot_ref) ?? ZERO, claim.qty)
		);
	}

	return input.items.filter(isActiveOneTime).map((item) => {
		const qtyPerPersonMissing = item.qty_per_person == null;
		const demand = persistQty(parseQty(people).times(item.qty_per_person ?? 1));

		// Only live, positive lots count; a claim held on an excluded lot is not double-counted.
		let onHand = ZERO;
		let reserved = ZERO;
		for (const lot of lotsByItem.get(item._id) ?? []) {
			if (!qtyGt(lot.qty, 0) || isLotExpired(lot, now, item)) continue;
			onHand = addQty(onHand, lot.qty);
			reserved = addQty(reserved, reservationsByLot.get(lot.lot_ref) ?? ZERO);
		}
		const net = subQty(onHand, reserved);
		const available = qtyGt(net, 0) ? net : ZERO;
		const gap = subQty(demand, available);

		return {
			itemId: item._id,
			name: item.name,
			unit: item.base_unit || item.unit || '',
			demand,
			available,
			shortfall: qtyGt(gap, 0) ? gap : ZERO,
			coverage: qtyGt(demand, 0)
				? parseQty(available).div(demand).times(100).toDecimalPlaces(2).toString()
				: null,
			status: qtyGte(available, demand) ? 'enough' : 'short',
			qtyPerPersonMissing
		};
	});
}

/** "83%" — rounded to a whole percent; "—" when there is no demand to cover. */
export function formatCoveragePercent(coverage: string | null): string {
	if (coverage === null) return '—';
	return `${new Decimal(coverage).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString()}%`;
}

/** Short rows first, then coverage ascending (no demand sorts last), then name. */
export function sortOneTimeDemandRows(rows: readonly OneTimeDemandRow[]): OneTimeDemandRow[] {
	const rank = (row: OneTimeDemandRow) => (row.status === 'short' ? 0 : 1);
	return [...rows].sort((a, b) => {
		if (rank(a) !== rank(b)) return rank(a) - rank(b);
		if (a.coverage !== b.coverage) {
			if (a.coverage === null) return 1;
			if (b.coverage === null) return -1;
			const diff = new Decimal(a.coverage).comparedTo(b.coverage);
			if (diff !== 0) return diff;
		}
		return a.name.localeCompare(b.name, 'th');
	});
}
