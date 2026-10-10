/**
 * Distribution fixtures — canonical CR-121 `requisition_ticket` + `distribution_log` docs plus
 * the `stock_ledger` rows the workflow would have written. Two scenarios:
 * - desk: tickets already dispatched (`IN_TRANSIT` / `DISTRIBUTING`) for `/onsite/distribution`
 * - back-office: tickets before dispatch (`PENDING_PICK` / `READY_FOR_DISPATCH`) plus opening
 *   stock lots, so a user can approve and dispatch them from `/back-office/distribution`
 *
 * Pure: no I/O. `run-distribution.ts` loads the catalog/people and writes the result.
 * Edit a scenario by changing `DESK_TICKETS` / `deskLogs()` or `BACK_OFFICE_TICKETS` /
 * `OPENING_STOCK` below.
 */
import type { AuthorContext } from '$lib/db/model';
import { itemMasterUnit } from '$lib/features/catalog/domain/catalog';
import {
	createDistributionLog,
	createFlow2RequisitionTicket,
	distributionLogDocSchema,
	requisitionTicketDocSchema,
	type DistributionLog,
	type MealPeriod,
	type RequisitionTicket
} from '$lib/features/distribution/domain/food-supplies';
import {
	createLegacyFlow2StockLedger,
	createStockLedger,
	type StockLedger
} from '$lib/features/operations/domain/operations';
import { qtyNeg } from '$lib/utils/qty';

export const DISTRIBUTION_ACTOR = 'seed-distribution';

/** `item_master.name` (from `pnpm seed:master`) for every item the scenario uses. */
export const DISTRIBUTION_ITEM_NAMES = {
	mealGeneral: 'ข้าวกล่องทั่วไป',
	mealHalal: 'ข้าวกล่องฮาลาล',
	kit: 'ถุงยังชีพธารน้ำใจ',
	blanket: 'ผ้าห่มกันหนาว',
	mat: 'เสื่อปูนอน',
	net: 'มุ้ง'
} as const;
export type DistributionItemKey = keyof typeof DISTRIBUTION_ITEM_NAMES;

export interface DistributionCatalogItem {
	_id: string;
	name: string;
	category?: string;
	type_class: 'CONSUMABLE' | 'DURABLE' | 'EQUIPMENT';
	returnable?: boolean;
	base_unit?: string;
	unit?: string;
}
export type DistributionCatalog = Record<DistributionItemKey, DistributionCatalogItem>;

export interface DistributionRecipient {
	id: string;
	householdId?: string;
}

/** Fixed, schema-valid ULID suffix so the seed is idempotent and resettable. */
const seedUlid = (n: number) => `01M5DESK${String(n).padStart(18, '0')}`;
/** Back-office scenario ids — separate range so each scenario resets on its own. */
const backOfficeUlid = (n: number) => `01M5BACK${String(n).padStart(18, '0')}`;

/** Ledger ids start above the ticket/log ranges (those share numbers but not `_id` prefixes). */
const LEDGER_ID_BASE = 100;

const WAREHOUSE = 'warehouse:main';
const TRUCK = { driver_name: 'สมชาย ใจดี', license_plate: 'กข 1234 สงขลา' } as const;
/** Minutes before now that every seeded ticket was dispatched. */
const DISPATCHED_MINUTES_AGO = 90;

// ─── Scenario ────────────────────────────────────────────────────────────────

interface TicketFixture {
	ticket_no: string;
	requisition_type: 'food' | 'supplies';
	meal?: MealPeriod;
	status: 'PENDING_PICK' | 'READY_FOR_DISPATCH' | 'IN_TRANSIT' | 'DISTRIBUTING';
	lines: ReadonlyArray<readonly [DistributionItemKey, number]>;
}

/** Desk tabs: IN_TRANSIT → step 1 (receive); DISTRIBUTING → steps 2–5. */
const DESK_TICKETS = {
	lunchOnTruck: {
		ticket_no: 'TKT-FOOD-900001',
		requisition_type: 'food',
		meal: 'lunch',
		status: 'IN_TRANSIT',
		lines: [
			['mealGeneral', 120],
			['mealHalal', 30]
		]
	},
	suppliesOnTruck: {
		ticket_no: 'TKT-SUPPLIES-900002',
		requisition_type: 'supplies',
		status: 'IN_TRANSIT',
		lines: [
			['kit', 40],
			['net', 20]
		]
	},
	breakfast: {
		ticket_no: 'TKT-FOOD-900003',
		requisition_type: 'food',
		meal: 'breakfast',
		status: 'DISTRIBUTING',
		lines: [
			['mealGeneral', 80],
			['mealHalal', 20]
		]
	},
	supplies: {
		ticket_no: 'TKT-SUPPLIES-900004',
		requisition_type: 'supplies',
		status: 'DISTRIBUTING',
		lines: [
			['kit', 50],
			['blanket', 30],
			['mat', 30]
		]
	}
} as const satisfies Record<string, TicketFixture>;
type DeskTicketKey = keyof typeof DESK_TICKETS;

interface LogFixture {
	ticket: DeskTicketKey;
	item: DistributionItemKey;
	/** Index into the loaded recipients. */
	person: number;
	qty: number;
	minutesAgo: number;
	override?: string;
	voided?: boolean;
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

function deskLogs(): LogFixture[] {
	return [
		// Breakfast: 12 people served (every 4th halal, every 5th takes 2) …
		...range(0, 12).map((p): LogFixture => ({
			ticket: 'breakfast',
			item: p % 4 === 3 ? 'mealHalal' : 'mealGeneral',
			person: p,
			qty: p % 5 === 0 ? 2 : 1,
			minutesAgo: 60 - p * 3
		})),
		// … one duplicate allowed with a reason, one voided mis-scan.
		{
			ticket: 'breakfast',
			item: 'mealGeneral',
			person: 0,
			qty: 1,
			minutesAgo: 20,
			override: 'รับแทนผู้ป่วยติดเตียงในครอบครัว'
		},
		{ ticket: 'breakfast', item: 'mealGeneral', person: 12, qty: 1, minutesAgo: 15, voided: true },
		// Supplies: kits to 8 households, blanket/mat loans to 10 people (still out).
		...range(0, 8).map((p): LogFixture => ({
			ticket: 'supplies',
			item: 'kit',
			person: p,
			qty: 1,
			minutesAgo: 120 - p * 5
		})),
		...range(8, 18).map((p, i): LogFixture => ({
			ticket: 'supplies',
			item: i % 2 ? 'mat' : 'blanket',
			person: p,
			qty: 1,
			minutesAgo: 100 - i * 4
		}))
	];
}

/** How many active evacuees the scenario needs in the shelter DB. */
export const DISTRIBUTION_RECIPIENTS_NEEDED = Math.max(...deskLogs().map((l) => l.person)) + 1;

// ─── Builder ─────────────────────────────────────────────────────────────────

function ticketLine(catalog: DistributionCatalog, key: DistributionItemKey, qty: number) {
	const item = catalog[key];
	return {
		item_id: item._id,
		item_name: item.name,
		...(item.category ? { category: item.category } : {}),
		type_class: item.type_class,
		...(item.returnable ? { returnable: true } : {}),
		requested_qty: String(qty),
		allocated_qty: String(qty)
	};
}

/** A ticket at `f.status`, carrying the actor/truck fields each earlier step would have set. */
function buildTicket(
	f: TicketFixture,
	catalog: DistributionCatalog,
	destination: string,
	ctx: AuthorContext,
	id: string
): RequisitionTicket {
	const actor = ctx.createdBy;
	const base = createFlow2RequisitionTicket(
		{
			ticket_no: f.ticket_no,
			requisition_type: f.requisition_type,
			...(f.meal ? { meal: f.meal } : {}),
			source_location: WAREHOUSE,
			destination_location: destination,
			items: f.lines.map(([item, qty]) => ticketLine(catalog, item, qty))
		},
		ctx,
		id
	);
	const approved = f.status !== 'PENDING_PICK';
	const dispatched = f.status === 'IN_TRANSIT' || f.status === 'DISTRIBUTING';
	return requisitionTicketDocSchema.parse({
		...base,
		status: f.status,
		...(approved ? { approved_by: actor } : {}),
		...(dispatched ? { ...TRUCK, dispatched_by: actor } : {}),
		...(f.status === 'DISTRIBUTING' ? { received_by: actor } : {})
	}) as RequisitionTicket;
}

/** ISO timestamp `minutesAgo` before `now`. */
const ago = (now: number, minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

export interface DistributionDocs {
	tickets: RequisitionTicket[];
	logs: DistributionLog[];
	ledger: StockLedger[];
}

export function buildDistributionDocs(
	catalog: DistributionCatalog,
	people: readonly DistributionRecipient[],
	destination: string,
	ctx: AuthorContext,
	now = Date.now()
): DistributionDocs {
	if (people.length < DISTRIBUTION_RECIPIENTS_NEEDED) {
		throw new Error(`Need ${DISTRIBUTION_RECIPIENTS_NEEDED} recipients, got ${people.length}`);
	}
	const actor = ctx.createdBy;
	let ledgerSeq = LEDGER_ID_BASE;

	/** Opening stock + the dispatch `distribute` row per line, as dispatchTicket writes them. */
	const dispatchLedger = (ticket: RequisitionTicket): StockLedger[] =>
		ticket.items.flatMap((line) => {
			const item = Object.values(catalog).find((c) => c._id === line.item_id);
			if (!item) throw new Error(`No catalog item for ${line.item_id}`);
			const unit = itemMasterUnit(item);
			const lotId = `stock_ledger:${seedUlid(ledgerSeq++)}`;
			return [
				createLegacyFlow2StockLedger(
					{ item_id: line.item_id, qty: line.allocated_qty, unit, reason: 'adjust', ref_id: null },
					ctx,
					lotId
				),
				createStockLedger(
					{
						item_id: line.item_id,
						qty: qtyNeg(line.allocated_qty),
						unit,
						reason: 'distribute',
						ref_id: ticket._id,
						lot_ref: lotId,
						occurred_at: ago(now, DISPATCHED_MINUTES_AGO)
					},
					ctx,
					`stock_ledger:${seedUlid(ledgerSeq++)}`
				)
			];
		});

	const ticketKeys = Object.keys(DESK_TICKETS) as DeskTicketKey[];
	const ticketByKey = new Map<DeskTicketKey, RequisitionTicket>(
		ticketKeys.map((key, i) => [
			key,
			buildTicket(DESK_TICKETS[key], catalog, destination, ctx, seedUlid(i + 1))
		])
	);
	const tickets = [...ticketByKey.values()];
	const ledger = tickets.flatMap(dispatchLedger);

	const logs = deskLogs().map((f, i) => {
		const ticket = ticketByKey.get(f.ticket)!;
		const person = people[f.person];
		const log = createDistributionLog(
			{
				ticket_id: ticket._id,
				item_id: catalog[f.item]._id,
				qty: String(f.qty),
				recipient_type: 'evacuee',
				recipient_id: person.id,
				...(person.householdId ? { household_id: person.householdId } : {}),
				...(ticket.meal ? { meal: ticket.meal } : {}),
				is_returnable: Boolean(catalog[f.item].returnable),
				is_override: Boolean(f.override),
				...(f.override ? { override_reason: f.override } : {}),
				distributed_at: ago(now, f.minutesAgo)
			},
			ctx,
			seedUlid(i + 1)
		);
		if (!f.voided) return log;
		return distributionLogDocSchema.parse({
			...log,
			status: 'voided',
			voided_at: ago(now, f.minutesAgo - 1),
			voided_by: actor
		}) as DistributionLog;
	});

	return { tickets, logs, ledger };
}

// ─── Back-office scenario ────────────────────────────────────────────────────

/** Tickets before dispatch: approve (`PENDING_PICK`) or dispatch (`READY_FOR_DISPATCH`) them. */
const BACK_OFFICE_TICKETS = [
	{
		ticket_no: 'TKT-FOOD-910001',
		requisition_type: 'food',
		meal: 'dinner',
		status: 'PENDING_PICK',
		lines: [
			['mealGeneral', 100],
			['mealHalal', 25]
		]
	},
	{
		ticket_no: 'TKT-SUPPLIES-910002',
		requisition_type: 'supplies',
		status: 'PENDING_PICK',
		lines: [
			['blanket', 20],
			['mat', 20]
		]
	},
	{
		ticket_no: 'TKT-FOOD-910003',
		requisition_type: 'food',
		meal: 'lunch',
		status: 'READY_FOR_DISPATCH',
		lines: [
			['mealGeneral', 120],
			['mealHalal', 30]
		]
	},
	{
		ticket_no: 'TKT-SUPPLIES-910004',
		requisition_type: 'supplies',
		status: 'READY_FOR_DISPATCH',
		lines: [
			['kit', 40],
			['net', 20]
		]
	}
] as const satisfies readonly TicketFixture[];

/** Opening balance per item — enough for every back-office ticket to pick a lot. */
const OPENING_STOCK: Record<DistributionItemKey, number> = {
	mealGeneral: 400,
	mealHalal: 100,
	kit: 150,
	blanket: 80,
	mat: 80,
	net: 60
};
/** Ready meals expire this many hours after the seed runs; other items have no expiry. */
const READY_MEAL_SHELF_HOURS = 12;
const READY_MEAL_KEYS: ReadonlySet<DistributionItemKey> = new Set(['mealGeneral', 'mealHalal']);

/** `L-YYMMDD-NNN` for the Thailand calendar day of `now`. */
function lotNo(now: number, n: number): string {
	const yymmdd = new Date(now + 7 * 3_600_000).toISOString().slice(2, 10).replaceAll('-', '');
	return `L-${yymmdd}-${String(n).padStart(3, '0')}`;
}

export interface BackOfficeDocs {
	tickets: RequisitionTicket[];
	ledger: StockLedger[];
}

export function buildBackOfficeDocs(
	catalog: DistributionCatalog,
	destination: string,
	ctx: AuthorContext,
	now = Date.now()
): BackOfficeDocs {
	const tickets = BACK_OFFICE_TICKETS.map((f, i) =>
		buildTicket(f, catalog, destination, ctx, backOfficeUlid(i + 1))
	);
	const stockKeys = Object.keys(OPENING_STOCK) as DistributionItemKey[];
	// Opening stock is `adjust` with no source doc — what the back-office manual receive writes.
	const ledger = stockKeys.map((key, i) => {
		const item = catalog[key];
		return createLegacyFlow2StockLedger(
			{
				item_id: item._id,
				qty: String(OPENING_STOCK[key]),
				unit: itemMasterUnit(item),
				reason: 'adjust',
				ref_id: null,
				lot: {
					lot_no: lotNo(now, i + 1),
					storage_zone: 'คลังหลัก',
					...(READY_MEAL_KEYS.has(key)
						? { expiry: new Date(now + READY_MEAL_SHELF_HOURS * 3_600_000).toISOString() }
						: {})
				},
				occurred_at: ago(now, DISPATCHED_MINUTES_AGO)
			},
			ctx,
			`stock_ledger:${backOfficeUlid(LEDGER_ID_BASE + i)}`
		);
	});
	return { tickets, ledger };
}
