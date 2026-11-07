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

/** Who received an item, by kind of person (the same three groups as the shelter head count). */
export interface ReceivedBreakdown {
	evacuees: number;
	staff: number;
	volunteers: number;
}

const NO_RECEIVED: ReceivedBreakdown = { evacuees: 0, staff: 0, volunteers: 0 };

/** A person who already received an item (a `distribution_log` that is not voided). */
export interface OneTimeRecipient {
	item_id: string;
	/** Null for a recipient from outside the shelter. */
	recipient_id: string | null;
}

/** The ledger columns the at-counter figure reads. */
export interface CounterLedgerRow {
	item_id: string;
	reason: string;
	/** Signed qty_str: negative = out of the warehouse. */
	qty: string;
	ref_id: string | null;
	lot?: { note?: string } | null;
}

/** The distribution-log columns the at-counter figure reads. */
export interface CounterLogRow {
	item_id: string;
	qty: string;
	qty_returned: string;
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
	/** `received` split by kind of person. */
	receivedBreakdown: ReceivedBreakdown;
	/** Units dispatched to a distribution point and not yet handed out (qty_str). */
	atCounter: string;
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
	receivedByItem?: ReadonlyMap<string, ReceivedBreakdown>;
	/** Units out at a distribution point per item id (see {@link unitsAtCounter}). Default: none. */
	atCounterByItem?: ReadonlyMap<string, string>;
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
): Map<string, ReceivedBreakdown> {
	const seen = new Set<string>();
	const counts = new Map<string, ReceivedBreakdown>();
	for (const { item_id, recipient_id } of recipients) {
		const person = recipient_id === null ? undefined : presentKeys.get(recipient_id);
		if (!person) continue;
		const key = `${item_id}\n${person}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const breakdown = counts.get(item_id) ?? { evacuees: 0, staff: 0, volunteers: 0 };
		// The person key keeps the group: `evacuee:*`, `volunteer:*` or `user:*` (staff).
		if (person.startsWith('evacuee:')) breakdown.evacuees += 1;
		else if (person.startsWith('volunteer:')) breakdown.volunteers += 1;
		else breakdown.staff += 1;
		counts.set(item_id, breakdown);
	}
	return counts;
}

/** `lot.note` of a `receive` row that puts a distributed unit back into the warehouse. */
const COUNTER_LOAN_RETURN_NOTES: ReadonlySet<string> = new Set([
	'counter_loan_return',
	'bulk_return_pool'
]);

/**
 * Stock coming back from a distribution point to the warehouse. Three shapes exist:
 * - leftover of a ticket: `distribution_return`, or a `receive` noted `distribution_return` when the
 *   lot is unknown, both citing the ticket; a batch's leftover return (`distribution_batch:*`) has no
 *   matching dispatch and is not one;
 * - a person bringing a loaned unit back at the counter, or through a bulk return pool: a `receive`
 *   noted `counter_loan_return` / `bulk_return_pool` (its log is then marked returned).
 */
function isReturnToWarehouse(row: CounterLedgerRow): boolean {
	if (row.reason === 'receive' && COUNTER_LOAN_RETURN_NOTES.has(row.lot?.note ?? '')) return true;
	if (!row.ref_id?.startsWith('requisition_ticket:')) return false;
	return (
		row.reason === 'distribution_return' ||
		(row.reason === 'receive' && row.lot?.note === 'distribution_return')
	);
}

/**
 * Per item, the units sent to a distribution point (`distribute` rows of a requisition ticket) that
 * were neither given to someone nor sent back. = dispatched − returned − (handed out − returned by
 * the person). Floored at 0 per item, and only items that have some are in the map.
 */
export function unitsAtCounter(
	ledger: readonly CounterLedgerRow[],
	logs: readonly CounterLogRow[]
): Map<string, string> {
	const net = new Map<string, Decimal>();
	const add = (itemId: string, delta: Decimal) =>
		net.set(itemId, (net.get(itemId) ?? new Decimal(0)).plus(delta));
	for (const row of ledger) {
		if (row.reason === 'distribute' && row.ref_id?.startsWith('requisition_ticket:')) {
			add(row.item_id, parseQty(row.qty).neg());
		} else if (isReturnToWarehouse(row)) {
			add(row.item_id, parseQty(row.qty).neg());
		}
	}
	for (const log of logs) {
		add(log.item_id, parseQty(log.qty).neg().plus(parseQty(log.qty_returned)));
	}
	const out = new Map<string, string>();
	for (const [itemId, value] of net) {
		if (value.gt(0)) out.set(itemId, persistQty(value));
	}
	return out;
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
		const receivedBreakdown = input.receivedByItem?.get(item._id) ?? NO_RECEIVED;
		const received = Math.min(
			receivedBreakdown.evacuees + receivedBreakdown.staff + receivedBreakdown.volunteers,
			people
		);
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
		// Units already dispatched to a distribution point are committed: they count towards the need.
		const atCounter = input.atCounterByItem?.get(item._id) ?? ZERO;
		const covered = addQty(available, atCounter);
		const gap = subQty(demand, covered);

		return {
			itemId: item._id,
			name: item.name,
			unit: item.base_unit || item.unit || '',
			received,
			receivedBreakdown,
			demand,
			available,
			atCounter,
			shortfall: qtyGt(gap, 0) ? gap : ZERO,
			coverage: qtyGt(demand, 0)
				? parseQty(covered).div(demand).times(100).toDecimalPlaces(2, Decimal.ROUND_DOWN).toString()
				: null,
			status: demandStatus(covered, demand),
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
