import Decimal from 'decimal.js';
import { isLotExpired, type StockLotBalance } from '$lib/features/operations';
import { addQty, parseQty, persistQty, qtyGt, qtyGte, subQty } from '$lib/utils/qty';

/**
 * Demand vs stock for one-time items (`distribution_type = one_time`), per CR-236 (#1190). Pure: the people base (`countShelterPeople`, CR-223),
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

/** A person who already received an item (a `distribution_log` that is not voided). */
export interface OneTimeRecipient {
	item_id: string;
	recipient_id: string;
}

/**
 * `enough`: available covers the need. `partial`: at least half of it. `shortage`: under half.
 * The 50% line is the same one the coverage bar uses.
 */
export type OneTimeDemandStatus = 'enough' | 'partial' | 'shortage';

/** Share of the need (as a percent) at and above which a short item still counts as partial. */
export const PARTIAL_COVERAGE_PERCENT = 50;

export interface OneTimeDemandRow {
	itemId: string;
	name: string;
	unit: string;
	/** People still in the shelter who already received this item. */
	received: number;
	/** (people − received) × qty_per_person (qty_str): what is still to hand out. */
	demand: string;
	/** Non-expired lot balance − active reservations, floored at 0 (qty_str). */
	available: string;
	/** max(0, demand − available) (qty_str). */
	shortfall: string;
	/** available ÷ demand × 100, two decimals, rounded down; null when demand is 0. */
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
	/** People already served, per item id (see {@link countCurrentRecipients}). Default: none. */
	receivedByItem?: ReadonlyMap<string, number>;
	/** Epoch ms; lot expiry is judged against it. */
	now: number;
}

const ZERO = '0';

function demandStatus(available: string, demand: string): OneTimeDemandStatus {
	if (qtyGte(available, demand)) return 'enough';
	// available / demand >= 50%, compared without dividing.
	const half = new Decimal(PARTIAL_COVERAGE_PERCENT).div(100);
	return parseQty(available).gte(parseQty(demand).times(half)) ? 'partial' : 'shortage';
}

function isActiveOneTime(item: OneTimeDemandItem): boolean {
	return item.distribution_type === 'one_time' && !item.deactivated && !item.merged_into;
}

/**
 * Maps every `distribution_log.recipient_id` that names a person counted in the shelter base to one
 * key for that person: an evacuee still staying (`evacuee:*`), a volunteer checked in here
 * (`volunteer:*`) and staff (`user:*`). A volunteer who is also a staff account answers to both ids
 * but stays one person, as in `countShelterPeople`.
 */
export function presentRecipientKeys(input: {
	evacueeIds: readonly string[];
	volunteers: readonly { id: string; userName?: string | null }[];
	staffNames: readonly string[];
}): Map<string, string> {
	const keys = new Map<string, string>();
	for (const id of input.evacueeIds) keys.set(id, id);
	for (const { id, userName } of input.volunteers) {
		keys.set(id, id);
		if (userName) keys.set(`user:${userName}`, id);
	}
	for (const name of input.staffNames) keys.set(`user:${name}`, `user:${name}`);
	return keys;
}

/**
 * Per item, how many distinct people still counted in the shelter received it. A recipient who has
 * since left is not counted, so they do not lower the need of the people who are here.
 */
export function countCurrentRecipients(
	recipients: readonly OneTimeRecipient[],
	presentKeys: ReadonlyMap<string, string>
): Map<string, number> {
	const seen = new Set<string>();
	const counts = new Map<string, number>();
	for (const { item_id, recipient_id } of recipients) {
		const person = presentKeys.get(recipient_id);
		if (!person) continue;
		const key = `${item_id}\n${person}`;
		if (seen.has(key)) continue;
		seen.add(key);
		counts.set(item_id, (counts.get(item_id) ?? 0) + 1);
	}
	return counts;
}

/** Ids of the active one-time items: the only ledger rows this view needs to read. */
export function oneTimeItemIds(items: readonly OneTimeDemandItem[]): string[] {
	return items.filter(isActiveOneTime).map((item) => item._id);
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
		// FR-2: unset or 0 means "not configured" -> 1. FR-8: number -> Decimal via its string form.
		const qtyPerPersonMissing = !item.qty_per_person;
		const perPerson = qtyPerPersonMissing
			? new Decimal(1)
			: new Decimal(String(item.qty_per_person));
		// Someone who already got a one-time item does not need it again.
		const received = Math.min(input.receivedByItem?.get(item._id) ?? 0, people);
		const demand = persistQty(new Decimal(String(people - received)).times(perPerson));

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
			received,
			demand,
			available,
			shortfall: qtyGt(gap, 0) ? gap : ZERO,
			coverage: qtyGt(demand, 0)
				? parseQty(available)
						.div(demand)
						.times(100)
						.toDecimalPlaces(2, Decimal.ROUND_DOWN)
						.toString()
				: null,
			status: demandStatus(available, demand),
			qtyPerPersonMissing
		};
	});
}

/** "63.3%" — always one decimal; a row still short never reads "100%"; "—" when there is no demand. */
export function formatCoveragePercent(coverage: string | null): string {
	if (coverage === null) return '—';
	const value = new Decimal(coverage);
	const rounded = value.toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
	const capped = value.lt(100) && rounded.gte(100) ? new Decimal('99.9') : rounded;
	return `${capped.toFixed(1)}%`;
}

/** Width (0–100) of the coverage bar: coverage clamped, 0 when there is no demand. */
export function coverageBarWidth(coverage: string | null): number {
	if (coverage === null) return 0;
	return Math.min(100, Math.max(0, Number(coverage)));
}

/** Short rows first, then coverage ascending (no demand sorts last), then name. */
export function sortOneTimeDemandRows(rows: readonly OneTimeDemandRow[]): OneTimeDemandRow[] {
	const rank = (row: OneTimeDemandRow) => (row.status === 'enough' ? 1 : 0);
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
