import type { AuthorContext } from '$lib/db/model';
import { now } from '$lib/db/model';
import { addQty, parseQty, qtyAbs, qtyGt, qtyLte, subQty } from '$lib/utils/qty';
import { catalogRepository } from '$lib/features/catalog';
import { nonNegativeWholeQtySchema } from '../../domain/food-supplies';
import {
	createStockLedger,
	deriveDeterministicLedgerId,
	expiryInstant,
	toLotPriorityItems,
	type LotPriorityItem,
	type OperationsRepository,
	type StockLedger,
	operationsRepository
} from '$lib/features/operations';
import { ConflictError } from '$lib/utils/errors';
import type { RequisitionTicket, TicketItem } from '../../domain/food-supplies';
import {
	DistributionLogRemoteRepository,
	type DistributionLogRepository,
	RequisitionTicketRemoteRepository,
	type RequisitionTicketRepository
} from '../../data/food-supplies';
import { assertCanPerformFrontlineDistribution, assertCanReceiveWarehouseReturns } from './auth';
import {
	assertNoSkippedDocs,
	StockIntegrityError,
	TicketStateError,
	WorkflowValidationError
} from './errors';
import { assertLedgerReplayBase } from './ledger-replay';
import { resolveCanonicalItemUnits, type CanonicalUnitCatalogRepository } from './canonical-unit';

function assertWarehouseReturnLedgerSemantics(
	actual: StockLedger,
	expected: StockLedger,
	ctx: AuthorContext,
	expectedId: string,
	expectedLotRef: string | undefined = expected.lot_ref
): void {
	assertLedgerReplayBase(
		actual,
		{
			id: expectedId,
			schemaVersion: expected.schema_v,
			shelterCode: ctx.shelterCode,
			reason: 'receive',
			refId: expected.ref_id,
			itemId: expected.item_id,
			qty: expected.qty,
			unit: expected.unit,
			lotRef: expectedLotRef
		},
		`Warehouse return ledger replay mismatch for ${expected._id}`
	);
	if (actual.lot?.note !== 'distribution_return') {
		throw new StockIntegrityError(`Warehouse return ledger replay mismatch for ${expected._id}`);
	}
}

function assertDistributionReturnLedgerSemantics(
	actual: StockLedger,
	expected: StockLedger,
	ctx: AuthorContext
): void {
	const message = `Warehouse return ledger replay mismatch for ${expected._id}`;
	assertLedgerReplayBase(
		actual,
		{
			id: expected._id,
			schemaVersion: expected.schema_v,
			shelterCode: ctx.shelterCode,
			reason: 'distribution_return',
			refId: expected.ref_id,
			itemId: expected.item_id,
			qty: expected.qty,
			unit: expected.unit,
			lotRef: expected.lot_ref
		},
		message
	);
	if (actual.lot !== undefined) {
		throw new StockIntegrityError(message);
	}
}

function assertReturnRowReplay(
	actual: StockLedger,
	expected: StockLedger,
	ctx: AuthorContext
): void {
	if (expected.reason === 'distribution_return') {
		assertDistributionReturnLedgerSemantics(actual, expected, ctx);
	} else {
		assertWarehouseReturnLedgerSemantics(actual, expected, ctx, expected._id);
	}
}

const MS_DAY = 86_400_000;
const UNRESOLVED_LOT_KEY = 'unresolved_lot';

/** One planned return row; `lot_ref: null` is the share no source lot can be named for (CR-208 §1.1). */
interface PlannedReturnRow {
	_id: string;
	lot_ref: string | null;
	qty: string;
}

interface ReturnSourceLot {
	lot_ref: string;
	dispensed: string;
	/** Absolute expiry in epoch ms; `null` when neither `lot.expiry` nor shelf life is known. */
	expiresAt: number | null;
	received_at: string;
}

/**
 * The row that opened each wanted physical lot: the earliest positive, non-return row per lot
 * key in `projectStockLotBalances` order (`occurred_at`, `_id`), which is where a lot's
 * metadata comes from.
 */
function indexLotOrigins(
	ledger: readonly StockLedger[],
	wanted: ReadonlySet<string>
): Map<string, StockLedger> {
	const origins = new Map<string, StockLedger>();
	for (const entry of ledger) {
		if (!qtyGt(entry.qty, 0) || entry.reason === 'distribution_return') continue;
		const lotRef = entry.lot_ref ?? entry._id;
		if (!wanted.has(lotRef)) continue;
		const current = origins.get(lotRef);
		const isEarlier =
			!current ||
			(entry.occurred_at.localeCompare(current.occurred_at) ||
				entry._id.localeCompare(current._id)) < 0;
		if (isEarlier) origins.set(lotRef, entry);
	}
	return origins;
}

/** CR-208 §2 — absolute, independent of `now`, so a replay derives the same order. */
function lotExpiresAt(origin: StockLedger, item: LotPriorityItem | undefined): number | null {
	const expiry = expiryInstant(origin.lot?.expiry);
	if (!Number.isNaN(expiry)) return expiry;
	const shelfLifeDays = item?.shelf_life_days;
	if (typeof shelfLifeDays !== 'number' || !Number.isFinite(shelfLifeDays)) return null;
	const produced = Date.parse(origin.lot?.produced_at ?? '');
	const start = Number.isNaN(produced) ? Date.parse(origin.occurred_at) : produced;
	return Number.isNaN(start) ? null : start + shelfLifeDays * MS_DAY;
}

function compareReturnOrder(a: ReturnSourceLot, b: ReturnSourceLot): number {
	if (a.expiresAt !== b.expiresAt) {
		if (a.expiresAt === null) return 1;
		if (b.expiresAt === null) return -1;
		return a.expiresAt - b.expiresAt;
	}
	return a.received_at.localeCompare(b.received_at) || a.lot_ref.localeCompare(b.lot_ref);
}

/**
 * CR-208 §1–§2: split one item's verified return over the lots its ticket dispatched from,
 * earliest expiry first, up to what each lot gave out; whatever no source lot can be named for
 * goes last as one new-lot `receive`. The first row keeps the pre-CR-208 id so an old client's
 * retry collides with it and fails closed instead of receiving the stock twice (§1.2).
 */
async function planItemReturnLedger(
	ticketId: string,
	itemId: string,
	unit: string,
	verifiedQty: string,
	distributeRows: readonly StockLedger[],
	origins: ReadonlyMap<string, StockLedger>,
	priorityItem: LotPriorityItem | undefined,
	ctx: AuthorContext
): Promise<StockLedger[]> {
	const lots = new Map<string, ReturnSourceLot>();
	let unresolved = '0';
	for (const row of distributeRows) {
		const origin = row.lot_ref ? origins.get(row.lot_ref) : undefined;
		if (!row.lot_ref || !origin || origin.item_id !== itemId || origin.unit !== unit) {
			unresolved = addQty(unresolved, qtyAbs(row.qty));
			continue;
		}
		const lot = lots.get(row.lot_ref) ?? {
			lot_ref: row.lot_ref,
			dispensed: '0',
			expiresAt: lotExpiresAt(origin, priorityItem),
			received_at: origin.occurred_at
		};
		lot.dispensed = addQty(lot.dispensed, qtyAbs(row.qty));
		lots.set(row.lot_ref, lot);
	}

	const sources = [
		...[...lots.values()].sort(compareReturnOrder),
		{ lot_ref: null, dispensed: unresolved }
	];
	let remaining = verifiedQty;
	const shares: Omit<PlannedReturnRow, '_id'>[] = [];
	for (const source of sources) {
		const qty = qtyLte(remaining, source.dispensed) ? remaining : source.dispensed;
		if (!qtyGt(qty, 0)) continue;
		shares.push({ lot_ref: source.lot_ref, qty });
		remaining = subQty(remaining, qty);
	}
	if (qtyGt(remaining, 0)) {
		throw new StockIntegrityError(
			`Warehouse verified return for ${itemId} exceeds what ticket ${ticketId} dispatched`
		);
	}

	const rows: StockLedger[] = [];
	for (const [index, share] of shares.entries()) {
		const _id =
			index === 0
				? await deriveDeterministicLedgerId('warehouse_return', ticketId, itemId)
				: await deriveDeterministicLedgerId(
						'warehouse_return',
						ticketId,
						itemId,
						share.lot_ref ?? UNRESOLVED_LOT_KEY
					);
		rows.push(await buildReturnLedger({ _id, ...share }, itemId, unit, ticketId, ctx));
	}
	return rows;
}

async function buildReturnLedger(
	row: PlannedReturnRow,
	itemId: string,
	unit: string,
	ticketId: string,
	ctx: AuthorContext
): Promise<StockLedger> {
	const base = { item_id: itemId, qty: row.qty, unit, ref_id: ticketId, occurred_at: now() };
	return row.lot_ref === null
		? createStockLedger(
				{ ...base, reason: 'receive', lot: { note: 'distribution_return' } },
				ctx,
				row._id
			)
		: createStockLedger(
				{ ...base, reason: 'distribution_return', lot_ref: row.lot_ref },
				ctx,
				row._id
			);
}

/**
 * FR-RTN-09 — an item received before CR-208: only `receive` rows and none at the
 * unresolved-share id the new layout would use.
 */
async function isLegacyReturnShape(
	ticketId: string,
	itemId: string,
	existing: readonly StockLedger[]
): Promise<boolean> {
	if (existing.length === 0 || existing.some((entry) => entry.reason !== 'receive')) return false;
	const unresolvedId = await deriveDeterministicLedgerId(
		'warehouse_return',
		ticketId,
		itemId,
		UNRESOLVED_LOT_KEY
	);
	return !existing.some((entry) => entry._id === unresolvedId);
}

/** The pre-CR-208 replay rules, unchanged: one `receive` row per item at the verified qty. */
function assertLegacyReturnReplay(
	existing: readonly StockLedger[],
	expected: StockLedger,
	verifiedQty: string,
	isCompletedReplay: boolean,
	ctx: AuthorContext
): void {
	if (existing.length > 1) {
		throw new StockIntegrityError(
			`Multiple warehouse return ledger rows exist for ticket item ${expected.item_id}`
		);
	}
	if (!qtyGt(verifiedQty, 0)) {
		throw new StockIntegrityError(
			`Zero-quantity warehouse return for ${expected.item_id} cannot have a receipt ledger row`
		);
	}
	const [entry] = existing;
	// Deliberately asymmetric, as before CR-208 (FR-RTN-09): the pending path never pinned the
	// id, so a mid-flight legacy ticket must keep replaying; only a completed one is held to it.
	if (isCompletedReplay) {
		assertWarehouseReturnLedgerSemantics(entry, expected, ctx, expected._id);
	} else {
		assertWarehouseReturnLedgerSemantics(entry, expected, ctx, entry._id, entry.lot_ref);
	}
}

export interface ReconciliationDependencies {
	ticketRepo?: RequisitionTicketRepository;
	logRepo?: DistributionLogRepository;
	operationsRepo?: OperationsRepository;
	catalogRepo?: CanonicalUnitCatalogRepository;
}

export interface ItemReconciliationSummary {
	item_id: string;
	item_name: string;
	allocated_qty: string;
	distributed_qty: string;
	remaining_in_hand: string;
}

export interface ShiftCloseOptions {
	/** Optional explicit physical returned quantities if different from remaining in-hand */
	returned_quantities?: Record<string, string>;
}

export interface VerifiedWarehouseReturns {
	/** Actual verified quantities counted at warehouse dock */
	verified_returned_quantities?: Record<string, string>;
}

function resolveDependencies(
	deps: ReconciliationDependencies | undefined,
	ctx: AuthorContext
): {
	ticketRepo: RequisitionTicketRepository;
	logRepo: DistributionLogRepository;
	operationsRepo: OperationsRepository;
} {
	return {
		ticketRepo: deps?.ticketRepo ?? new RequisitionTicketRemoteRepository(ctx.shelterCode),
		logRepo: deps?.logRepo ?? new DistributionLogRemoteRepository(ctx.shelterCode),
		operationsRepo: deps?.operationsRepo ?? operationsRepository(ctx.shelterCode)
	};
}

/**
 * Calculates current shift reconciliation dynamically from DistributionLog entries (AC-DST-02.2).
 */
export async function calculateShiftReconciliation(
	ticketId: string,
	ctx: AuthorContext,
	deps?: ReconciliationDependencies
): Promise<{
	ticket: RequisitionTicket;
	summaries: ItemReconciliationSummary[];
	hasLeftoverOrReturns: boolean;
}> {
	const { ticketRepo, logRepo } = resolveDependencies(deps, ctx);
	const ticket = await ticketRepo.get(ticketId);
	if (!ticket) {
		throw new TicketStateError(`Ticket ${ticketId} not found`);
	}

	// Fail closed: a skipped malformed log of this ticket would silently understate the totals.
	const { items: allLogs, skipped } = await logRepo.listWithSkipped({ ticket_id: ticketId });
	assertNoSkippedDocs(skipped, 'shift reconciliation');
	const activeLogs = allLogs.filter((l) => l.status !== 'voided');

	let hasLeftoverOrReturns = false;
	const summaries: ItemReconciliationSummary[] = ticket.items.map((item) => {
		const itemLogs = activeLogs.filter((l) => l.item_id === item.item_id);
		const distributed = itemLogs.reduce((acc, l) => addQty(acc, l.qty), '0');
		const allocated = item.allocated_qty || '0';
		const remainingInHand = subQty(allocated, distributed);

		if (qtyGt(remainingInHand, 0)) {
			hasLeftoverOrReturns = true;
		}

		return {
			item_id: item.item_id,
			item_name: item.item_name,
			allocated_qty: allocated,
			distributed_qty: distributed,
			remaining_in_hand: remainingInHand
		};
	});

	return {
		ticket,
		summaries,
		hasLeftoverOrReturns
	};
}

/**
 * Closes frontline shift, updating ticket summary quantities (Step 5).
 * If all goods were 100% distributed with 0 returns, transitions directly to COMPLETED.
 * If leftovers or returnable items exist, transitions to SHIFT_CLOSED.
 */
export async function closeShift(
	ticketId: string,
	options: ShiftCloseOptions | undefined,
	ctx: AuthorContext,
	deps?: ReconciliationDependencies
): Promise<RequisitionTicket> {
	assertCanPerformFrontlineDistribution(ctx);

	const { ticketRepo } = resolveDependencies(deps, ctx);
	const { ticket, summaries } = await calculateShiftReconciliation(ticketId, ctx, deps);

	if (ticket.status !== 'DISTRIBUTING') {
		throw new TicketStateError(
			`Cannot close shift for ticket ${ticketId} in status '${ticket.status}'; expected DISTRIBUTING`
		);
	}

	const summaryMap = new Map(summaries.map((s) => [s.item_id, s]));
	let totalRemainingToReturn = '0';

	const updatedItems: TicketItem[] = ticket.items.map((item) => {
		const summary = summaryMap.get(item.item_id);
		const distributed = summary ? summary.distributed_qty : item.distributed_qty || '0';
		const remainingInHand = summary ? summary.remaining_in_hand : '0';

		const returned = options?.returned_quantities?.[item.item_id] ?? remainingInHand;
		const allocated = item.allocated_qty || '0';
		const accounted = addQty(distributed, returned);
		const discrepancy = subQty(allocated, accounted);

		totalRemainingToReturn = addQty(totalRemainingToReturn, returned);

		return {
			...item,
			distributed_qty: distributed,
			returned_qty: returned,
			discrepancy_qty: discrepancy
		};
	});

	// If 100% distributed and 0 physical returns remain, ticket can transition to COMPLETED via SHIFT_CLOSED
	const hasReturns = qtyGt(totalRemainingToReturn, 0);

	const closedTicket = await ticketRepo.transitionTicket(ticketId, 'SHIFT_CLOSED', ctx, {
		items: updatedItems
	});

	if (!hasReturns) {
		return ticketRepo.transitionTicket(ticketId, 'COMPLETED', ctx);
	}

	return closedTicket;
}

/**
 * Frontline submits returns back to central warehouse, transitioning SHIFT_CLOSED -> RETURN_PENDING_RECEIPT (Step 6).
 */
export async function submitReturnsToWarehouse(
	ticketId: string,
	ctx: AuthorContext,
	deps?: ReconciliationDependencies
): Promise<RequisitionTicket> {
	assertCanPerformFrontlineDistribution(ctx);

	const { ticketRepo } = resolveDependencies(deps, ctx);
	const current = await ticketRepo.get(ticketId);
	if (!current) {
		throw new TicketStateError(`Ticket ${ticketId} not found`);
	}
	if (current.status !== 'SHIFT_CLOSED') {
		throw new TicketStateError(
			`Cannot submit returns for ticket ${ticketId} in status '${current.status}'; expected SHIFT_CLOSED`
		);
	}

	return ticketRepo.transitionTicket(ticketId, 'RETURN_PENDING_RECEIPT', ctx);
}

/**
 * Central warehouse inspects physical returns dockside, marks ticket RETURN_COMPLETED, then
 * creates the inbound stock ledger rows (Step 7). A replay of a RETURN_COMPLETED ticket with the
 * same counts writes whatever rows are still missing.
 */
export async function receiveWarehouseReturns(
	ticketId: string,
	options: VerifiedWarehouseReturns | undefined,
	ctx: AuthorContext,
	deps?: ReconciliationDependencies
): Promise<{ ticket: RequisitionTicket; ledgerEntriesCreated: number }> {
	assertCanReceiveWarehouseReturns(ctx);

	const { ticketRepo, operationsRepo } = resolveDependencies(deps, ctx);
	const current = await ticketRepo.get(ticketId);
	if (!current) {
		throw new TicketStateError(`Ticket ${ticketId} not found`);
	}
	const isCompletedReplay = current.status === 'RETURN_COMPLETED';
	if (current.status !== 'RETURN_PENDING_RECEIPT' && !isCompletedReplay) {
		throw new TicketStateError(
			`Cannot receive warehouse returns for ticket ${ticketId} in status '${current.status}'; expected RETURN_PENDING_RECEIPT`
		);
	}
	const itemUnits = await resolveCanonicalItemUnits(
		current.items.map((item) => item.item_id),
		ctx,
		deps?.catalogRepo
	);

	const requestedQuantities = options?.verified_returned_quantities ?? {};
	const ticketItemIds = new Set(current.items.map((item) => item.item_id));
	for (const itemId of Object.keys(requestedQuantities)) {
		if (!ticketItemIds.has(itemId)) {
			throw new WorkflowValidationError(
				`Cannot receive warehouse return for unknown ticket item ${itemId}`
			);
		}
	}

	const verifiedByItem = new Map<string, string>();
	for (const item of current.items) {
		const rawVerified = requestedQuantities[item.item_id] ?? item.returned_qty ?? '0';
		const parsedVerified = nonNegativeWholeQtySchema.safeParse(rawVerified);
		if (!parsedVerified.success) {
			throw new WorkflowValidationError(
				`Warehouse verified return for ${item.item_id} must be a non-negative whole number`
			);
		}
		const verifiedQty = parsedVerified.data;

		const expectedReturn = item.returned_qty ?? '0';
		const remainingAfterDistribution = subQty(item.allocated_qty, item.distributed_qty ?? '0');
		if (!qtyLte(verifiedQty, expectedReturn)) {
			throw new WorkflowValidationError(
				`Warehouse verified return for ${item.item_id} cannot exceed the ${expectedReturn} sent from the shift`
			);
		}
		if (!qtyLte(verifiedQty, remainingAfterDistribution)) {
			throw new StockIntegrityError(
				`Warehouse verified return for ${item.item_id} exceeds its ${remainingAfterDistribution} ticket remainder`
			);
		}
		verifiedByItem.set(item.item_id, verifiedQty);
	}

	if (isCompletedReplay) {
		for (const item of current.items) {
			const verifiedReturned = verifiedByItem.get(item.item_id)!;
			const discrepancy = subQty(
				subQty(item.allocated_qty, item.distributed_qty || '0'),
				verifiedReturned
			);
			if (
				item.returned_qty === undefined ||
				!parseQty(item.returned_qty).eq(verifiedReturned) ||
				item.discrepancy_qty === undefined ||
				!parseQty(item.discrepancy_qty).eq(discrepancy)
			) {
				throw new StockIntegrityError(
					`Completed warehouse return reconciliation for ${item.item_id} does not match the requested final quantities`
				);
			}
		}
	}

	const ledger = await operationsRepo.listLedger();
	const existingByItem = new Map<string, StockLedger[]>();
	for (const entry of ledger) {
		if (entry.ref_id !== current._id) continue;
		if (entry.reason !== 'receive' && entry.reason !== 'distribution_return') continue;
		if (!ticketItemIds.has(entry.item_id)) {
			throw new StockIntegrityError(
				`Warehouse return ledger ${entry._id} references unknown ticket item ${entry.item_id}`
			);
		}
		const itemEntries = existingByItem.get(entry.item_id) ?? [];
		itemEntries.push(entry);
		existingByItem.set(entry.item_id, itemEntries);
	}

	const catalog = deps?.catalogRepo ?? catalogRepository();
	const priorityItems = toLotPriorityItems(await catalog.listItemMasters(ctx.shelterCode));
	const ticketDistributeRows = ledger.filter(
		(entry) => entry.reason === 'distribute' && entry.ref_id === current._id
	);
	const origins = indexLotOrigins(
		ledger,
		new Set(ticketDistributeRows.flatMap((entry) => (entry.lot_ref ? [entry.lot_ref] : [])))
	);

	// Phase 1: verify every item's existing rows and plan the missing ones, so an impossible
	// return (FR-RTN-04) or a replay mismatch throws before any row is written.
	const pendingWrites: StockLedger[] = [];
	for (const item of current.items) {
		const verifiedReturned = verifiedByItem.get(item.item_id)!;
		const existing = existingByItem.get(item.item_id) ?? [];
		const unit = itemUnits.get(item.item_id);
		if (!unit) {
			throw new StockIntegrityError(
				`Missing canonical unit for warehouse return item ${item.item_id}`
			);
		}

		if (await isLegacyReturnShape(current._id, item.item_id, existing)) {
			assertLegacyReturnReplay(
				existing,
				await buildReturnLedger(
					{
						_id: await deriveDeterministicLedgerId('warehouse_return', current._id, item.item_id),
						lot_ref: null,
						qty: verifiedReturned
					},
					item.item_id,
					unit,
					current._id,
					ctx
				),
				verifiedReturned,
				isCompletedReplay,
				ctx
			);
			continue;
		}

		const expected = qtyGt(verifiedReturned, 0)
			? await planItemReturnLedger(
					current._id,
					item.item_id,
					unit,
					verifiedReturned,
					ticketDistributeRows.filter((entry) => entry.item_id === item.item_id),
					origins,
					priorityItems.get(item.item_id),
					ctx
				)
			: [];
		const expectedById = new Map(expected.map((entry) => [entry._id, entry]));
		for (const entry of existing) {
			const match = expectedById.get(entry._id);
			if (!match) {
				throw new StockIntegrityError(
					`Warehouse return ledger ${entry._id} is not part of the expected return for ${item.item_id}`
				);
			}
			assertReturnRowReplay(entry, match, ctx);
		}
		const existingIds = new Set(existing.map((entry) => entry._id));
		pendingWrites.push(...expected.filter((entry) => !existingIds.has(entry._id)));
	}

	// The ticket transition is the fence: a CAS on one doc, so of two receipts with different
	// counts only one completes the ticket and the other stops here before writing a row. A
	// smaller count's rows are a subset of a larger one's, so the ledger ids alone cannot tell
	// them apart.
	let ticket = current;
	if (!isCompletedReplay) {
		const updatedItems: TicketItem[] = current.items.map((item) => {
			const verifiedReturned = verifiedByItem.get(item.item_id)!;
			const remaining = subQty(item.allocated_qty || '0', item.distributed_qty || '0');
			return {
				...item,
				returned_qty: verifiedReturned,
				discrepancy_qty: subQty(remaining, verifiedReturned)
			};
		});
		try {
			ticket = await ticketRepo.transitionTicket(ticketId, 'RETURN_COMPLETED', ctx, {
				items: updatedItems
			});
		} catch (error) {
			const latest = await ticketRepo.get(ticketId);
			if (latest?.status !== 'RETURN_COMPLETED') throw error;
			const differing = latest.items.find(
				(item) =>
					item.returned_qty === undefined ||
					!parseQty(item.returned_qty).eq(verifiedByItem.get(item.item_id) ?? '0')
			);
			if (differing) {
				throw new StockIntegrityError(
					`Ticket ${ticketId} was already received with a different count for ${differing.item_id}`
				);
			}
			// Another receipt completed the ticket first at our counts: finish its rows.
			return receiveWarehouseReturns(
				ticketId,
				{ verified_returned_quantities: Object.fromEntries(verifiedByItem) },
				ctx,
				deps
			);
		}
	}

	// Phase 2: write the missing rows, each item's first row before the rest (FR-RTN-11).
	let ledgerEntriesCreated = 0;
	for (const ledgerEntry of pendingWrites) {
		try {
			await operationsRepo.addLedgerEntry(ledgerEntry);
			ledgerEntriesCreated++;
		} catch (error) {
			if (!(error instanceof ConflictError)) throw error;
			const recoveredLedger = await operationsRepo.getLedgerEntry(ledgerEntry._id);
			if (!recoveredLedger) {
				throw new StockIntegrityError(
					`ConflictError on ${ledgerEntry._id} but existing warehouse return ledger could not be fetched`
				);
			}
			assertReturnRowReplay(recoveredLedger, ledgerEntry, ctx);
		}
	}

	return { ticket, ledgerEntriesCreated };
}

/**
 * Completes a ticket after returns have been processed dockside (RETURN_COMPLETED -> COMPLETED)
 * or closes out a shift-closed ticket with no outstanding returns.
 */
export async function completeTicket(
	ticketId: string,
	ctx: AuthorContext,
	deps?: ReconciliationDependencies
): Promise<RequisitionTicket> {
	assertCanReceiveWarehouseReturns(ctx);

	const { ticketRepo } = resolveDependencies(deps, ctx);
	const current = await ticketRepo.get(ticketId);
	if (!current) {
		throw new TicketStateError(`Ticket ${ticketId} not found`);
	}
	if (current.status !== 'RETURN_COMPLETED' && current.status !== 'SHIFT_CLOSED') {
		throw new TicketStateError(
			`Cannot complete ticket ${ticketId} in status '${current.status}'; expected RETURN_COMPLETED or SHIFT_CLOSED`
		);
	}
	if (current.status === 'RETURN_COMPLETED') {
		// A receipt that completed the ticket but stopped before all its rows landed is finished
		// here, so a ticket never closes with returned stock missing from the ledger.
		await receiveWarehouseReturns(
			ticketId,
			{
				verified_returned_quantities: Object.fromEntries(
					current.items.map((item) => [item.item_id, item.returned_qty ?? '0'])
				)
			},
			ctx,
			deps
		);
	}

	return ticketRepo.transitionTicket(ticketId, 'COMPLETED', ctx);
}
