import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/features/catalog', () => ({
	catalogRepository: () => ({
		listItemMasters: async () =>
			['item:a', 'item:b', 'item:blanket', 'item:c', 'item:mat', 'item:meal', 'item:rice'].map(
				(_id) => ({ _id, base_unit: 'piece' })
			),
		listUnitsOfMeasure: async () => []
	}),
	itemMasterUnit: (item: { base_unit?: string; unit?: string }) =>
		item.base_unit ?? item.unit ?? 'piece',
	canonicalizeUnitCode: (value: unknown) => (value === 'ชิ้น' ? 'piece' : value)
}));
import { ulid } from '$lib/db/ulid';
import type { AuthorContext } from '$lib/db/model';
import type {
	DistributionLog,
	DistributionLogInput,
	Flow2RequisitionTicket,
	RequisitionTicket,
	RequisitionTicketInput
} from '../../domain/food-supplies';
import {
	assertRequisitionTicketTransition,
	createDistributionLog
} from '../../domain/food-supplies';
import type {
	DistributionLogListFilter,
	DistributionLogRepository,
	RequisitionTicketRepository
} from '../../data/food-supplies';
import {
	createStockLedger,
	deriveDeterministicLedgerId,
	projectStockLotBalances,
	type OperationsRepository,
	type StockLedger,
	type StockLot
} from '$lib/features/operations';
import { subQty } from '$lib/utils/qty';
import type { CanonicalUnitCatalogRepository } from './canonical-unit';
import { ConflictError } from '$lib/utils/errors';
import {
	calculateShiftReconciliation,
	closeShift,
	completeTicket,
	receiveWarehouseReturns,
	submitReturnsToWarehouse
} from './reconciliation-workflow';
import { DistributionDataIntegrityError, StockIntegrityError } from './errors';

class InMemoryTicketRepository implements RequisitionTicketRepository {
	tickets = new Map<string, RequisitionTicket>();
	failNextTransition: Error | null = null;

	async create(
		input: RequisitionTicketInput | Flow2RequisitionTicket,
		ctx: AuthorContext
	): Promise<Flow2RequisitionTicket> {
		const id = `requisition_ticket:${ulid()}`;
		const doc = {
			_id: id,
			type: 'requisition_ticket',
			schema_v: 1,
			shelter_code: ctx.shelterCode,
			ticket_no: `TKT-${input.requisition_type.toUpperCase()}-0001`,
			requisition_type: input.requisition_type,
			meal: 'meal' in input ? input.meal : undefined,
			source_location: input.source_location,
			destination_location: input.destination_location,
			status: 'DISTRIBUTING' as const,
			requested_by: ctx.createdBy,
			items: input.items.map((i) => {
				const item = i as { requested_qty: string; allocated_qty?: string };
				return {
					...i,
					allocated_qty: item.allocated_qty ?? item.requested_qty
				};
			}),
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			created_by: ctx.createdBy
		} as unknown as Flow2RequisitionTicket;
		this.tickets.set(id, doc);
		return doc;
	}

	async get(ticketId: string): Promise<RequisitionTicket | null> {
		return this.tickets.get(ticketId) ?? null;
	}

	async list(): Promise<RequisitionTicket[]> {
		return Array.from(this.tickets.values());
	}

	async mutateTicketCAS(
		ticketId: string,
		mutator: (current: RequisitionTicket) => RequisitionTicket,
		_ctx: AuthorContext
	): Promise<RequisitionTicket> {
		void _ctx;
		const current = this.tickets.get(ticketId);
		if (!current) throw new Error('Not found');
		const updated = mutator(current);
		this.tickets.set(ticketId, updated);
		return updated;
	}

	async transitionTicket(
		ticketId: string,
		toStatus: RequisitionTicket['status'],
		_ctx: AuthorContext,
		patch?: Partial<RequisitionTicket>
	): Promise<RequisitionTicket> {
		void _ctx;
		if (this.failNextTransition) {
			const error = this.failNextTransition;
			this.failNextTransition = null;
			throw error;
		}
		const current = this.tickets.get(ticketId);
		if (!current) throw new Error('Not found');
		assertRequisitionTicketTransition(current, toStatus);
		const updated = {
			...current,
			...patch,
			status: toStatus,
			updated_at: new Date().toISOString()
		};
		this.tickets.set(ticketId, updated);
		return updated;
	}
}

class InMemoryLogRepository implements Partial<DistributionLogRepository> {
	logs = new Map<string, DistributionLog>();

	async create(
		input: DistributionLogInput | DistributionLog,
		ctx: AuthorContext
	): Promise<DistributionLog> {
		if ('_id' in input && input.type === 'distribution_log') {
			this.logs.set(input._id, input);
			return input;
		}
		const doc = createDistributionLog(input as DistributionLogInput, ctx);
		if ('status' in input && typeof input.status === 'string') {
			doc.status = input.status as DistributionLog['status'];
		}
		this.logs.set(doc._id, doc);
		return doc;
	}

	/** Malformed docs `listWithSkipped` reports as matching the filter (the repo does the matching). */
	skipped: { _id: string; type: string; reason: string }[] = [];

	async list(filter?: DistributionLogListFilter): Promise<DistributionLog[]> {
		return (await this.listWithSkipped(filter)).items;
	}

	async listWithSkipped(filter?: DistributionLogListFilter) {
		const items = Array.from(this.logs.values()).filter((l) => {
			if (filter?.ticket_id && l.ticket_id !== filter.ticket_id) return false;
			if (filter?.item_id && l.item_id !== filter.item_id) return false;
			return true;
		});
		return { items, skipped: this.skipped };
	}
}

class InMemoryOperationsRepository implements Partial<OperationsRepository> {
	ledger: StockLedger[] = [];
	failItemIdOnce: string | null = null;
	private addBarrier: { remaining: number; release: () => void; wait: Promise<void> } | null = null;

	holdNextLedgerWrites(count: number): void {
		let release: () => void = () => undefined;
		const wait = new Promise<void>((resolve) => {
			release = resolve;
		});
		this.addBarrier = { remaining: count, release, wait };
	}

	async addLedgerEntry(entry: StockLedger): Promise<StockLedger> {
		const barrier = this.addBarrier;
		if (barrier) {
			barrier.remaining -= 1;
			if (barrier.remaining === 0) {
				this.addBarrier = null;
				barrier.release();
			}
			await barrier.wait;
		}
		if (this.ledger.some((existing) => existing._id === entry._id)) {
			throw new ConflictError();
		}
		if (this.failItemIdOnce === entry.item_id) {
			this.failItemIdOnce = null;
			throw new Error(`simulated write failure for ${entry.item_id}`);
		}
		this.ledger.push(entry);
		return entry;
	}

	async getLedgerEntry(id: string): Promise<StockLedger | null> {
		return this.ledger.find((entry) => entry._id === id) ?? null;
	}

	async listLedger(): Promise<StockLedger[]> {
		return [...this.ledger];
	}
}

describe('reconciliation-workflow', () => {
	let ticketRepo: InMemoryTicketRepository;
	let logRepo: InMemoryLogRepository;
	let opsRepo: InMemoryOperationsRepository;
	const POS_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'pos_user',
		roles: ['shelter:SH001', 'SH001:distribution_staff']
	};
	const WH_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'wh_user',
		roles: ['shelter:SH001', 'warehouse_staff']
	};

	beforeEach(() => {
		ticketRepo = new InMemoryTicketRepository();
		logRepo = new InMemoryLogRepository();
		opsRepo = new InMemoryOperationsRepository();
	});

	/** Seeds one donated lot per ticket item and its full-allocation `distribute` row; returns lot_ref by item. */
	function seedDispatch(ticket: RequisitionTicket): Map<string, string> {
		const lotRefs = new Map<string, string>();
		for (const item of ticket.items) {
			const lot = createStockLedger(
				{
					item_id: item.item_id,
					qty: item.allocated_qty,
					unit: 'piece',
					reason: 'donation',
					ref_id: `donation:${ulid()}`,
					occurred_at: '2026-10-01T00:00:00.000Z'
				},
				WH_CTX
			);
			opsRepo.ledger.push(
				lot,
				createStockLedger(
					{
						item_id: item.item_id,
						qty: `-${item.allocated_qty}`,
						unit: 'piece',
						reason: 'distribute',
						ref_id: ticket._id,
						lot_ref: lot.lot_ref,
						occurred_at: '2026-10-02T00:00:00.000Z'
					},
					WH_CTX
				)
			);
			lotRefs.set(item.item_id, lot.lot_ref!);
		}
		return lotRefs;
	}

	/** The row `receiveWarehouseReturns` wrote before CR-208: one new-lot `receive` per item. */
	async function legacyReceiveRow(ticketId: string, itemId: string, qty: string) {
		return createStockLedger(
			{
				item_id: itemId,
				qty,
				unit: 'piece',
				reason: 'receive',
				ref_id: ticketId,
				lot: { note: 'distribution_return' },
				occurred_at: '2026-10-03T00:00:00.000Z'
			},
			WH_CTX,
			await deriveDeterministicLedgerId('warehouse_return', ticketId, itemId)
		);
	}

	const returnRows = (ticketId: string) =>
		opsRepo.ledger.filter(
			(entry) =>
				entry.ref_id === ticketId &&
				(entry.reason === 'receive' || entry.reason === 'distribution_return')
		);

	it('calculates shift reconciliation from distribution log history dynamically', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-FOOD-0001',
				requisition_type: 'food',
				meal: 'lunch',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:rice',
						item_name: 'Rice',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '100',
						allocated_qty: '100'
					}
				]
			},
			POS_CTX
		);

		await logRepo.create(
			{
				ticket_id: ticket._id,
				item_id: 'item:rice',
				qty: '40',
				recipient_type: 'outside',
				is_returnable: false,
				status: 'fulfilled',
				is_override: false
			},
			POS_CTX
		);
		await logRepo.create(
			{
				ticket_id: ticket._id,
				item_id: 'item:rice',
				qty: '35',
				recipient_type: 'outside',
				is_returnable: false,
				status: 'fulfilled',
				is_override: false
			},
			POS_CTX
		);
		// Voided log should not be counted
		await logRepo.create(
			{
				ticket_id: ticket._id,
				item_id: 'item:rice',
				qty: '10',
				recipient_type: 'outside',
				is_returnable: false,
				status: 'voided',
				is_override: false
			},
			POS_CTX
		);

		const result = await calculateShiftReconciliation(ticket._id, POS_CTX, {
			ticketRepo,
			logRepo: logRepo as unknown as DistributionLogRepository,
			operationsRepo: opsRepo as unknown as OperationsRepository
		});

		expect(result.summaries[0].allocated_qty).toBe('100');
		expect(result.summaries[0].distributed_qty).toBe('75');
		expect(result.summaries[0].remaining_in_hand).toBe('25');
		expect(result.hasLeftoverOrReturns).toBe(true);
	});

	describe('malformed distribution logs (fail closed)', () => {
		const BAD = {
			_id: 'distribution_log:01JBAD00000000000000000001',
			type: 'distribution_log',
			reason: 'x'
		};
		const deps = () => ({
			ticketRepo,
			logRepo: logRepo as unknown as DistributionLogRepository,
			operationsRepo: opsRepo as unknown as OperationsRepository
		});
		const makeTicket = () =>
			ticketRepo.create(
				{
					ticket_no: 'TKT-FOOD-0009',
					requisition_type: 'food',
					meal: 'lunch',
					source_location: 'warehouse:main',
					destination_location: 'point:a',
					items: [
						{
							item_id: 'item:rice',
							item_name: 'Rice',
							type_class: 'CONSUMABLE',
							returnable: false,
							requested_qty: '10',
							allocated_qty: '10'
						}
					]
				},
				POS_CTX
			);

		it('closeShift refuses to total when a malformed log of the ticket exists, naming its id', async () => {
			const ticket = await makeTicket();
			logRepo.skipped = [BAD];
			const attempt = closeShift(ticket._id, undefined, POS_CTX, deps());
			await expect(attempt).rejects.toBeInstanceOf(DistributionDataIntegrityError);
			await expect(attempt).rejects.toMatchObject({ docIds: [BAD._id] });
			expect((await ticketRepo.get(ticket._id))?.status).toBe('DISTRIBUTING');
		});

		it('calculateShiftReconciliation refuses the same way', async () => {
			const ticket = await makeTicket();
			logRepo.skipped = [BAD];
			await expect(
				calculateShiftReconciliation(ticket._id, POS_CTX, deps())
			).rejects.toBeInstanceOf(DistributionDataIntegrityError);
		});

		it('does not block when no malformed log matches the ticket', async () => {
			const ticket = await makeTicket();
			logRepo.skipped = [];
			const result = await calculateShiftReconciliation(ticket._id, POS_CTX, deps());
			expect(result.summaries[0].remaining_in_hand).toBe('10');
		});
	});

	it('closes shift and transitions directly to COMPLETED when 100% distributed (Case 1)', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-FOOD-0002',
				requisition_type: 'food',
				meal: 'dinner',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:meal',
						item_name: 'Meal',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '50',
						allocated_qty: '50'
					}
				]
			},
			POS_CTX
		);

		await logRepo.create(
			{
				ticket_id: ticket._id,
				item_id: 'item:meal',
				qty: '50',
				recipient_type: 'outside',
				is_returnable: false,
				status: 'fulfilled',
				is_override: false
			},
			POS_CTX
		);

		const closed = await closeShift(ticket._id, undefined, POS_CTX, {
			ticketRepo,
			logRepo: logRepo as unknown as DistributionLogRepository,
			operationsRepo: opsRepo as unknown as OperationsRepository
		});

		expect(closed.status).toBe('COMPLETED');
		expect(closed.items[0].distributed_qty).toBe('50');
		expect(closed.items[0].returned_qty).toBe('0');
		expect(closed.items[0].discrepancy_qty).toBe('0');
	});

	it('closes shift and transitions to SHIFT_CLOSED when leftovers or returnable items remain (Case 2)', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-0001',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:b',
				items: [
					{
						item_id: 'item:mat',
						item_name: 'Mat',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '30',
						allocated_qty: '30'
					}
				]
			},
			POS_CTX
		);

		await logRepo.create(
			{
				ticket_id: ticket._id,
				item_id: 'item:mat',
				qty: '20',
				recipient_type: 'outside',
				is_returnable: false,
				status: 'fulfilled',
				is_override: false
			},
			POS_CTX
		);

		const closed = await closeShift(ticket._id, undefined, POS_CTX, {
			ticketRepo,
			logRepo: logRepo as unknown as DistributionLogRepository,
			operationsRepo: opsRepo as unknown as OperationsRepository
		});

		expect(closed.status).toBe('SHIFT_CLOSED');
		expect(closed.items[0].distributed_qty).toBe('20');
		expect(closed.items[0].returned_qty).toBe('10'); // 10 remaining to return
		expect(closed.items[0].discrepancy_qty).toBe('0');
	});

	it('submits returns to warehouse transitioning SHIFT_CLOSED -> RETURN_PENDING_RECEIPT (Step 6)', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-0002',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:b',
				items: [
					{
						item_id: 'item:mat',
						item_name: 'Mat',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					}
				]
			},
			POS_CTX
		);
		ticketRepo.tickets.get(ticket._id)!.status = 'SHIFT_CLOSED';

		const submitted = await submitReturnsToWarehouse(ticket._id, POS_CTX, {
			ticketRepo,
			logRepo: logRepo as unknown as DistributionLogRepository,
			operationsRepo: opsRepo as unknown as OperationsRepository
		});

		expect(submitted.status).toBe('RETURN_PENDING_RECEIPT');
	});

	it('warehouse inspects and receives physical returns with inbound stock ledger (Step 7)', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-0003',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:b',
				items: [
					{
						item_id: 'item:mat',
						item_name: 'Mat',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '20',
						allocated_qty: '20'
					}
				]
			},
			POS_CTX
		);

		ticketRepo.tickets.get(ticket._id)!.status = 'RETURN_PENDING_RECEIPT';
		ticketRepo.tickets.get(ticket._id)!.items[0].distributed_qty = '15';
		ticketRepo.tickets.get(ticket._id)!.items[0].returned_qty = '5';
		const lotRefs = seedDispatch(ticketRepo.tickets.get(ticket._id)!);

		// Warehouse counts 4 (1 missing/damaged)
		const result = await receiveWarehouseReturns(
			ticket._id,
			{ verified_returned_quantities: { 'item:mat': '4' } },
			WH_CTX,
			{
				ticketRepo,
				logRepo: logRepo as unknown as DistributionLogRepository,
				operationsRepo: opsRepo as unknown as OperationsRepository
			}
		);

		expect(result.ticket.status).toBe('RETURN_COMPLETED');
		expect(result.ticket.items[0].returned_qty).toBe('4');
		expect(result.ticket.items[0].discrepancy_qty).toBe('1'); // 20 - 15 - 4 = 1
		expect(result.ledgerEntriesCreated).toBe(1);

		// CR-208: the leftovers go back into the lot they were dispatched from.
		const rows = returnRows(ticket._id);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			reason: 'distribution_return',
			ref_id: ticket._id,
			lot_ref: lotRefs.get('item:mat'),
			qty: '4',
			unit: 'piece'
		});
		expect(rows[0].lot).toBeUndefined();
	});

	it('does not create a receipt when the final warehouse count is zero', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-0003B',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:b',
				items: [
					{
						item_id: 'item:mat',
						item_name: 'Mat',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					}
				]
			},
			POS_CTX
		);
		const pending = ticketRepo.tickets.get(ticket._id)!;
		pending.status = 'RETURN_PENDING_RECEIPT';
		pending.items[0].distributed_qty = '6';
		pending.items[0].returned_qty = '4';

		const result = await receiveWarehouseReturns(
			ticket._id,
			{ verified_returned_quantities: { 'item:mat': '0' } },
			WH_CTX,
			{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
		);

		expect(result.ticket.status).toBe('RETURN_COMPLETED');
		expect(result.ticket.items[0].returned_qty).toBe('0');
		expect(result.ticket.items[0].discrepancy_qty).toBe('4');
		expect(result.ledgerEntriesCreated).toBe(0);
		expect(opsRepo.ledger).toHaveLength(0);
	});

	it('writes no receipt when the ticket transition fails, and the retry receives once', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-0003C',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:b',
				items: [
					{
						item_id: 'item:mat',
						item_name: 'Mat',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					}
				]
			},
			POS_CTX
		);
		const pending = ticketRepo.tickets.get(ticket._id)!;
		pending.status = 'RETURN_PENDING_RECEIPT';
		pending.items[0].distributed_qty = '6';
		pending.items[0].returned_qty = '4';
		seedDispatch(pending);
		ticketRepo.failNextTransition = new Error('simulated ticket CAS failure');

		await expect(
			receiveWarehouseReturns(
				ticket._id,
				{ verified_returned_quantities: { 'item:mat': '4' } },
				WH_CTX,
				{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
			)
		).rejects.toThrow('simulated ticket CAS failure');
		expect(returnRows(ticket._id)).toHaveLength(0);

		const retry = await receiveWarehouseReturns(
			ticket._id,
			{ verified_returned_quantities: { 'item:mat': '4' } },
			WH_CTX,
			{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
		);

		expect(retry.ledgerEntriesCreated).toBe(1);
		expect(returnRows(ticket._id)).toHaveLength(1);
		expect(retry.ticket.status).toBe('RETURN_COMPLETED');
	});

	it('keeps one receipt when same-target warehouse returns race', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-0003D',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:b',
				items: [
					{
						item_id: 'item:mat',
						item_name: 'Mat',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					}
				]
			},
			POS_CTX
		);
		const pending = ticketRepo.tickets.get(ticket._id)!;
		pending.status = 'RETURN_PENDING_RECEIPT';
		pending.items[0].distributed_qty = '6';
		pending.items[0].returned_qty = '4';
		seedDispatch(pending);
		opsRepo.holdNextLedgerWrites(2);

		await Promise.allSettled([
			receiveWarehouseReturns(
				ticket._id,
				{ verified_returned_quantities: { 'item:mat': '4' } },
				WH_CTX,
				{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
			),
			receiveWarehouseReturns(
				ticket._id,
				{ verified_returned_quantities: { 'item:mat': '4' } },
				WH_CTX,
				{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
			)
		]);

		expect(returnRows(ticket._id)).toHaveLength(1);
		expect(returnRows(ticket._id)[0].qty).toBe('4');
	});

	it('fails closed when competing final warehouse counts differ', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-0003E',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:b',
				items: [
					{
						item_id: 'item:mat',
						item_name: 'Mat',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					}
				]
			},
			POS_CTX
		);
		const pending = ticketRepo.tickets.get(ticket._id)!;
		pending.status = 'RETURN_PENDING_RECEIPT';
		pending.items[0].distributed_qty = '5';
		pending.items[0].returned_qty = '5';
		seedDispatch(pending);

		const results = await Promise.allSettled([
			receiveWarehouseReturns(
				ticket._id,
				{ verified_returned_quantities: { 'item:mat': '4' } },
				WH_CTX,
				{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
			),
			receiveWarehouseReturns(
				ticket._id,
				{ verified_returned_quantities: { 'item:mat': '5' } },
				WH_CTX,
				{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
			)
		]);

		expect(returnRows(ticket._id)).toHaveLength(1);
		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
		const rejected = results.find((result) => result.status === 'rejected');
		expect(rejected?.status).toBe('rejected');
		if (rejected?.status === 'rejected') {
			expect(rejected.reason).toBeInstanceOf(StockIntegrityError);
		}
	});

	it('rejects warehouse quantities above the shift return and unknown ticket items before ledger writes', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-0004',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:b',
				items: [
					{
						item_id: 'item:mat',
						item_name: 'Mat',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					}
				]
			},
			POS_CTX
		);
		const pending = ticketRepo.tickets.get(ticket._id)!;
		pending.status = 'RETURN_PENDING_RECEIPT';
		pending.items[0].distributed_qty = '6';
		pending.items[0].returned_qty = '4';

		await expect(
			receiveWarehouseReturns(
				ticket._id,
				{ verified_returned_quantities: { 'item:mat': '5' } },
				WH_CTX,
				{
					ticketRepo,
					logRepo: logRepo as unknown as DistributionLogRepository,
					operationsRepo: opsRepo as unknown as OperationsRepository
				}
			)
		).rejects.toThrow(/cannot exceed the 4 sent from the shift/);
		expect(opsRepo.ledger).toHaveLength(0);
		await expect(
			receiveWarehouseReturns(
				ticket._id,
				{ verified_returned_quantities: { 'item:mat': '-1' } },
				WH_CTX,
				{
					ticketRepo,
					logRepo: logRepo as unknown as DistributionLogRepository,
					operationsRepo: opsRepo as unknown as OperationsRepository
				}
			)
		).rejects.toThrow(/non-negative whole number/);
		expect(opsRepo.ledger).toHaveLength(0);

		await expect(
			receiveWarehouseReturns(
				ticket._id,
				{ verified_returned_quantities: { 'item:unknown': '1' } },
				WH_CTX,
				{
					ticketRepo,
					logRepo: logRepo as unknown as DistributionLogRepository,
					operationsRepo: opsRepo as unknown as OperationsRepository
				}
			)
		).rejects.toThrow(/unknown ticket item/);
		expect(opsRepo.ledger).toHaveLength(0);
	});

	it('receives each valid multi-item warehouse return exactly once', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-0005',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:b',
				items: [
					{
						item_id: 'item:mat',
						item_name: 'Mat',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					},
					{
						item_id: 'item:blanket',
						item_name: 'Blanket',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '8',
						allocated_qty: '8'
					}
				]
			},
			POS_CTX
		);
		const pending = ticketRepo.tickets.get(ticket._id)!;
		pending.status = 'RETURN_PENDING_RECEIPT';
		pending.items[0].distributed_qty = '6';
		pending.items[0].returned_qty = '4';
		pending.items[1].distributed_qty = '5';
		pending.items[1].returned_qty = '3';
		seedDispatch(pending);

		const result = await receiveWarehouseReturns(
			ticket._id,
			{ verified_returned_quantities: { 'item:mat': '4', 'item:blanket': '2' } },
			WH_CTX,
			{
				ticketRepo,
				logRepo: logRepo as unknown as DistributionLogRepository,
				operationsRepo: opsRepo as unknown as OperationsRepository
			}
		);
		expect(result.ledgerEntriesCreated).toBe(2);
		expect(
			returnRows(ticket._id)
				.map((entry) => entry.item_id)
				.sort()
		).toEqual(['item:blanket', 'item:mat']);
		expect(result.ticket.items[1].discrepancy_qty).toBe('1');
	});

	it('recovers A/B receipts and writes only missing C after a partial multi-item failure', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-0006',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:b',
				items: [
					{
						item_id: 'item:a',
						item_name: 'A',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					},
					{
						item_id: 'item:b',
						item_name: 'B',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					},
					{
						item_id: 'item:c',
						item_name: 'C',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					}
				]
			},
			POS_CTX
		);
		const pending = ticketRepo.tickets.get(ticket._id)!;
		pending.status = 'RETURN_PENDING_RECEIPT';
		for (const item of pending.items) {
			item.distributed_qty = '6';
			item.returned_qty = '4';
		}
		seedDispatch(pending);
		opsRepo.failItemIdOnce = 'item:c';

		await expect(
			receiveWarehouseReturns(
				ticket._id,
				{
					verified_returned_quantities: { 'item:a': '4', 'item:b': '3', 'item:c': '2' }
				},
				WH_CTX,
				{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
			)
		).rejects.toThrow('simulated write failure for item:c');
		expect(
			returnRows(ticket._id)
				.map((entry) => entry.item_id)
				.sort()
		).toEqual(['item:a', 'item:b']);

		const retry = await receiveWarehouseReturns(
			ticket._id,
			{ verified_returned_quantities: { 'item:a': '4', 'item:b': '3', 'item:c': '2' } },
			WH_CTX,
			{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
		);

		expect(retry.ledgerEntriesCreated).toBe(1);
		expect(returnRows(ticket._id)).toHaveLength(3);
		expect(retry.ticket.status).toBe('RETURN_COMPLETED');
	});

	it('keeps historical duplicate warehouse receipts fail-closed', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-0007',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:b',
				items: [
					{
						item_id: 'item:mat',
						item_name: 'Mat',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					}
				]
			},
			POS_CTX
		);
		const pending = ticketRepo.tickets.get(ticket._id)!;
		pending.status = 'RETURN_PENDING_RECEIPT';
		pending.items[0].distributed_qty = '6';
		pending.items[0].returned_qty = '4';
		seedDispatch(pending);
		const legacyReceipt = await legacyReceiveRow(ticket._id, 'item:mat', '4');
		opsRepo.ledger.push(legacyReceipt, {
			...legacyReceipt,
			_id: 'stock_ledger:01J00000000000000000000999'
		});
		const before = opsRepo.ledger.length;

		await expect(
			receiveWarehouseReturns(
				ticket._id,
				{ verified_returned_quantities: { 'item:mat': '4' } },
				WH_CTX,
				{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
			)
		).rejects.toBeInstanceOf(StockIntegrityError);
		expect(opsRepo.ledger).toHaveLength(before);
	});

	it('replays RETURN_COMPLETED with verified final quantities without new writes', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-0008',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:b',
				items: [
					{
						item_id: 'item:mat',
						item_name: 'Mat',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					}
				]
			},
			POS_CTX
		);
		const pending = ticketRepo.tickets.get(ticket._id)!;
		pending.status = 'RETURN_PENDING_RECEIPT';
		pending.items[0].distributed_qty = '6';
		pending.items[0].returned_qty = '4';
		seedDispatch(pending);

		await receiveWarehouseReturns(
			ticket._id,
			{ verified_returned_quantities: { 'item:mat': '4' } },
			WH_CTX,
			{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
		);
		const replay = await receiveWarehouseReturns(
			ticket._id,
			{ verified_returned_quantities: { 'item:mat': '4' } },
			WH_CTX,
			{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
		);

		expect(replay.ledgerEntriesCreated).toBe(0);
		expect(returnRows(ticket._id)).toHaveLength(1);
		expect(replay.ticket.status).toBe('RETURN_COMPLETED');
		await expect(
			receiveWarehouseReturns(
				ticket._id,
				{ verified_returned_quantities: { 'item:mat': '5' } },
				WH_CTX,
				{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
			)
		).rejects.toThrow();
		expect(returnRows(ticket._id)).toHaveLength(1);
	});

	describe('returns go back into their source lots (CR-208)', () => {
		const catalogWith = (shelfLifeDays: Record<string, number> = {}) =>
			({
				listItemMasters: async () =>
					['item:milk', 'item:rice'].map((_id) => ({
						_id,
						base_unit: 'piece',
						shelf_life_days: shelfLifeDays[_id]
					})),
				listUnitsOfMeasure: async () => []
			}) as unknown as CanonicalUnitCatalogRepository;

		function seedLot(
			itemId: string,
			qty: string,
			lot: StockLot = {},
			occurredAt = '2026-10-01T00:00:00.000Z',
			unit = 'piece'
		): string {
			const row = createStockLedger(
				{
					item_id: itemId,
					qty,
					unit,
					reason: 'donation',
					ref_id: `donation:${ulid()}`,
					lot,
					occurred_at: occurredAt
				},
				WH_CTX
			);
			opsRepo.ledger.push(row);
			return row.lot_ref!;
		}

		/** `lotRef` omitted = an in-flight top-up, whose row points at itself. */
		function seedDistribute(ticketId: string, itemId: string, qty: string, lotRef?: string) {
			const id = `stock_ledger:${ulid()}`;
			opsRepo.ledger.push(
				createStockLedger(
					{
						item_id: itemId,
						qty: `-${qty}`,
						unit: 'piece',
						reason: 'distribute',
						ref_id: ticketId,
						lot_ref: lotRef ?? id,
						occurred_at: '2026-10-20T00:00:00.000Z'
					},
					WH_CTX,
					id
				)
			);
		}

		async function pendingTicket(itemId: string, allocated: string, returned: string) {
			const ticket = await ticketRepo.create(
				{
					ticket_no: 'TKT-SUPPLIES-0208',
					requisition_type: 'supplies',
					source_location: 'warehouse:main',
					destination_location: 'point:b',
					items: [
						{
							item_id: itemId,
							item_name: itemId,
							type_class: 'CONSUMABLE',
							returnable: false,
							requested_qty: allocated,
							allocated_qty: allocated
						}
					]
				},
				POS_CTX
			);
			const pending = ticketRepo.tickets.get(ticket._id)!;
			pending.status = 'RETURN_PENDING_RECEIPT';
			pending.items[0].distributed_qty = subQty(allocated, returned);
			pending.items[0].returned_qty = returned;
			return pending;
		}

		const receive = (
			ticketId: string,
			quantities: Record<string, string>,
			catalogRepo = catalogWith()
		) =>
			receiveWarehouseReturns(ticketId, { verified_returned_quantities: quantities }, WH_CTX, {
				ticketRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository,
				catalogRepo
			});

		const shape = (rows: StockLedger[]) =>
			rows.map((row) => ({ reason: row.reason, lot_ref: row.lot_ref, qty: row.qty }));

		/** The #888 milk example: lot A (exp 28 Oct) 6, lot B (exp 31 Dec) 4, top-up with no lot 2. */
		async function milkTicket(returned: string) {
			const ticket = await pendingTicket('item:milk', '12', returned);
			const lotA = seedLot('item:milk', '20', {
				expiry: '2026-10-28',
				lot_no: 'L-261001-001',
				storage_point_id: 'sp1',
				storage_zone: 'A1'
			});
			const lotB = seedLot('item:milk', '20', { expiry: '2026-12-31' });
			seedDistribute(ticket._id, 'item:milk', '4', lotA);
			seedDistribute(ticket._id, 'item:milk', '4', lotB);
			seedDistribute(ticket._id, 'item:milk', '2', lotA);
			seedDistribute(ticket._id, 'item:milk', '2');
			return { ticket, lotA, lotB };
		}

		it.each([
			['3', [['A', '3']]],
			[
				'8',
				[
					['A', '6'],
					['B', '2']
				]
			],
			[
				'11',
				[
					['A', '6'],
					['B', '4'],
					['new', '1']
				]
			]
		])('splits a count of %s earliest expiry first', async (counted, expected) => {
			const { ticket, lotA, lotB } = await milkTicket(counted);

			const result = await receive(ticket._id, { 'item:milk': counted });

			const rows = returnRows(ticket._id);
			const lotOf = { A: lotA, B: lotB } as Record<string, string>;
			expect(shape(rows)).toEqual(
				expected.map(([lot, qty]) =>
					lot === 'new'
						? { reason: 'receive', lot_ref: rows.at(-1)!._id, qty }
						: { reason: 'distribution_return', lot_ref: lotOf[lot], qty }
				)
			);
			expect(result.ledgerEntriesCreated).toBe(expected.length);
			expect(result.ticket.status).toBe('RETURN_COMPLETED');
		});

		it('keeps the old id on the first row and derives the rest per lot', async () => {
			const { ticket, lotB } = await milkTicket('11');

			await receive(ticket._id, { 'item:milk': '11' });

			const [first, second, unresolved] = returnRows(ticket._id);
			expect(first._id).toBe(
				await deriveDeterministicLedgerId('warehouse_return', ticket._id, 'item:milk')
			);
			expect(second._id).toBe(
				await deriveDeterministicLedgerId('warehouse_return', ticket._id, 'item:milk', lotB)
			);
			expect(unresolved._id).toBe(
				await deriveDeterministicLedgerId(
					'warehouse_return',
					ticket._id,
					'item:milk',
					'unresolved_lot'
				)
			);
			expect(first.lot).toBeUndefined();
			expect(unresolved.lot?.note).toBe('distribution_return');
		});

		it('adds stock back to the source lot without opening a new one', async () => {
			const ticket = await pendingTicket('item:milk', '6', '3');
			const lotA = seedLot('item:milk', '20', {
				expiry: '2026-10-28',
				lot_no: 'L-261001-001',
				storage_point_id: 'sp1',
				storage_zone: 'A1'
			});
			seedDistribute(ticket._id, 'item:milk', '6', lotA);
			const lotsBefore = projectStockLotBalances(opsRepo.ledger).length;

			await receive(ticket._id, { 'item:milk': '3' });

			const lots = projectStockLotBalances(opsRepo.ledger);
			expect(lots).toHaveLength(lotsBefore);
			const source = lots.find((lot) => lot.lot_ref === lotA)!;
			expect(source.qty).toBe('17');
			expect(source.lot).toMatchObject({
				expiry: '2026-10-28',
				lot_no: 'L-261001-001',
				storage_point_id: 'sp1',
				storage_zone: 'A1'
			});
		});

		it('puts a lot with a known expiry before one with none, whatever their age', async () => {
			const ticket = await pendingTicket('item:rice', '10', '5');
			const undated = seedLot('item:rice', '10', {}, '2026-09-01T00:00:00.000Z');
			const dated = seedLot(
				'item:rice',
				'10',
				{ expiry: '2027-06-01' },
				'2026-10-01T00:00:00.000Z'
			);
			seedDistribute(ticket._id, 'item:rice', '5', undated);
			seedDistribute(ticket._id, 'item:rice', '5', dated);

			await receive(ticket._id, { 'item:rice': '5' });

			expect(shape(returnRows(ticket._id))).toEqual([
				{ reason: 'distribution_return', lot_ref: dated, qty: '5' }
			]);
		});

		it.each([
			['2026-11-15', 'shelfLife'],
			['2026-10-20', 'dated']
		])(
			'compares shelf-life expiry with lot.expiry %s as absolute instants',
			async (expiry, first) => {
				const ticket = await pendingTicket('item:milk', '10', '5');
				// produced 1 Oct + 30 days of shelf life = 31 Oct
				const shelfLife = seedLot('item:milk', '10', { produced_at: '2026-10-01T00:00:00.000Z' });
				const dated = seedLot('item:milk', '10', { expiry });
				seedDistribute(ticket._id, 'item:milk', '5', shelfLife);
				seedDistribute(ticket._id, 'item:milk', '5', dated);

				await receive(ticket._id, { 'item:milk': '5' }, catalogWith({ 'item:milk': 30 }));

				const lotRef = first === 'shelfLife' ? shelfLife : dated;
				expect(returnRows(ticket._id).map((row) => row.lot_ref)).toEqual([lotRef]);
			}
		);

		it("reads a lot's metadata from its earliest row, whatever order the ledger lists it in", async () => {
			const ticket = await pendingTicket('item:rice', '10', '5');
			const december = seedLot('item:rice', '10', { expiry: '2026-12-01' });
			const november = seedLot('item:rice', '10', { expiry: '2026-11-01' });
			const origin = opsRepo.ledger.find((row) => row._id === november)!;
			opsRepo.ledger.unshift({
				...origin,
				_id: 'stock_ledger:01J00000000000000000000888',
				occurred_at: '2026-10-10T00:00:00.000Z',
				lot: { expiry: '2027-01-01' }
			});
			seedDistribute(ticket._id, 'item:rice', '5', december);
			seedDistribute(ticket._id, 'item:rice', '5', november);

			await receive(ticket._id, { 'item:rice': '5' });

			expect(returnRows(ticket._id).map((row) => row.lot_ref)).toEqual([november]);
		});

		it('orders lots with no known expiry by received_at, then lot_ref', async () => {
			const ticket = await pendingTicket('item:rice', '10', '7');
			const newer = seedLot('item:rice', '10', {}, '2026-10-05T00:00:00.000Z');
			const older = seedLot('item:rice', '10', {}, '2026-10-01T00:00:00.000Z');
			seedDistribute(ticket._id, 'item:rice', '5', newer);
			seedDistribute(ticket._id, 'item:rice', '5', older);

			await receive(ticket._id, { 'item:rice': '7' });

			expect(shape(returnRows(ticket._id))).toEqual([
				{ reason: 'distribution_return', lot_ref: older, qty: '5' },
				{ reason: 'distribution_return', lot_ref: newer, qty: '2' }
			]);
		});

		it('plans the same rows whatever the clock says', async () => {
			vi.useFakeTimers({ toFake: ['Date'] });
			try {
				vi.setSystemTime(new Date('2026-10-25T00:00:00.000Z'));
				const { ticket } = await milkTicket('8');
				await receive(ticket._id, { 'item:milk': '8' }, catalogWith({ 'item:milk': 30 }));
				const written = shape(returnRows(ticket._id));
				const writtenIds = new Set(returnRows(ticket._id).map((row) => row._id));
				opsRepo.ledger = opsRepo.ledger.filter((row) => !writtenIds.has(row._id));

				vi.setSystemTime(new Date('2027-03-01T00:00:00.000Z'));
				const retry = await receive(
					ticket._id,
					{ 'item:milk': '8' },
					catalogWith({ 'item:milk': 30 })
				);

				expect(retry.ledgerEntriesCreated).toBe(written.length);
				expect(shape(returnRows(ticket._id))).toEqual(written);
			} finally {
				vi.useRealTimers();
			}
		});

		it('fails closed when shelf life changes the lot order between a partial write and the retry', async () => {
			const ticket = await pendingTicket('item:milk', '10', '8');
			// 30 days of shelf life ends 31 Oct (before the dated lot); 90 days ends 30 Dec (after it)
			const shelfLife = seedLot('item:milk', '10', { produced_at: '2026-10-01T00:00:00.000Z' });
			const dated = seedLot('item:milk', '10', { expiry: '2026-11-15' });
			seedDistribute(ticket._id, 'item:milk', '5', shelfLife);
			seedDistribute(ticket._id, 'item:milk', '5', dated);
			await receive(ticket._id, { 'item:milk': '8' }, catalogWith({ 'item:milk': 30 }));
			const [, second] = returnRows(ticket._id);
			opsRepo.ledger = opsRepo.ledger.filter((row) => row._id !== second._id);
			const before = opsRepo.ledger.length;

			await expect(
				receive(ticket._id, { 'item:milk': '8' }, catalogWith({ 'item:milk': 90 }))
			).rejects.toBeInstanceOf(StockIntegrityError);
			expect(opsRepo.ledger).toHaveLength(before);
			expect(shape(returnRows(ticket._id))).toEqual([
				{ reason: 'distribution_return', lot_ref: shelfLife, qty: '5' }
			]);
		});

		it('receives a top-up-only ticket as one new lot under the old id', async () => {
			const ticket = await pendingTicket('item:milk', '5', '2');
			seedDistribute(ticket._id, 'item:milk', '5');

			const result = await receive(ticket._id, { 'item:milk': '2' });

			const [row] = returnRows(ticket._id);
			expect(returnRows(ticket._id)).toHaveLength(1);
			expect(row).toMatchObject({ reason: 'receive', qty: '2', lot_ref: row._id });
			expect(row.lot?.note).toBe('distribution_return');
			expect(row._id).toBe(
				await deriveDeterministicLedgerId('warehouse_return', ticket._id, 'item:milk')
			);
			expect(result.ticket.status).toBe('RETURN_COMPLETED');
		});

		it('never returns into a lot of another item', async () => {
			const ticket = await pendingTicket('item:milk', '5', '3');
			const riceLot = seedLot('item:rice', '10');
			seedDistribute(ticket._id, 'item:milk', '5', riceLot);

			await receive(ticket._id, { 'item:milk': '3' });

			expect(shape(returnRows(ticket._id))).toEqual([
				{ reason: 'receive', lot_ref: returnRows(ticket._id)[0]._id, qty: '3' }
			]);
		});

		it('never returns into a lot kept in another unit', async () => {
			const ticket = await pendingTicket('item:milk', '5', '3');
			const crateLot = seedLot('item:milk', '10', {}, '2026-10-01T00:00:00.000Z', 'crate');
			seedDistribute(ticket._id, 'item:milk', '5', crateLot);

			await receive(ticket._id, { 'item:milk': '3' });

			const [row] = returnRows(ticket._id);
			expect(shape(returnRows(ticket._id))).toEqual([
				{ reason: 'receive', lot_ref: row._id, qty: '3' }
			]);
		});

		it('refuses a count above what the ticket dispatched and writes nothing', async () => {
			const ticket = await pendingTicket('item:milk', '10', '8');
			seedDistribute(ticket._id, 'item:milk', '5', seedLot('item:milk', '10'));
			const before = opsRepo.ledger.length;

			await expect(receive(ticket._id, { 'item:milk': '6' })).rejects.toBeInstanceOf(
				StockIntegrityError
			);
			expect(opsRepo.ledger).toHaveLength(before);
			expect(ticketRepo.tickets.get(ticket._id)!.status).toBe('RETURN_PENDING_RECEIPT');
		});

		describe('replay', () => {
			async function receivedOnce(counted = '11') {
				const milk = await milkTicket(counted);
				await receive(milk.ticket._id, { 'item:milk': counted });
				return milk;
			}

			it('writes nothing new when received twice', async () => {
				const { ticket } = await milkTicket('11');
				await receive(ticket._id, { 'item:milk': '11' });
				const written = returnRows(ticket._id);

				const replay = await receive(ticket._id, { 'item:milk': '11' });

				expect(replay.ledgerEntriesCreated).toBe(0);
				expect(returnRows(ticket._id)).toEqual(written);
			});

			it('writes only the missing rows after a partial write', async () => {
				const { ticket } = await receivedOnce();
				const expected = shape(returnRows(ticket._id));
				const [, dropped] = returnRows(ticket._id);
				opsRepo.ledger = opsRepo.ledger.filter((row) => row._id !== dropped._id);

				const retry = await receive(ticket._id, { 'item:milk': '11' });

				expect(retry.ledgerEntriesCreated).toBe(1);
				expect(shape(returnRows(ticket._id)).sort((a, b) => a.qty.localeCompare(b.qty))).toEqual(
					expected.sort((a, b) => a.qty.localeCompare(b.qty))
				);
			});

			it.each([
				[
					'a row with another qty',
					(rows: StockLedger[]) => {
						rows[1].qty = '3';
					}
				],
				[
					'a row on another lot',
					(rows: StockLedger[]) => {
						rows[0].lot_ref = rows[1].lot_ref;
					}
				],
				[
					'an extra row',
					(rows: StockLedger[]) => {
						opsRepo.ledger.push({ ...rows[1], _id: 'stock_ledger:01J00000000000000000000777' });
					}
				]
			])('fails closed on %s', async (_case, tamper) => {
				const { ticket } = await receivedOnce();
				tamper(returnRows(ticket._id));
				const before = opsRepo.ledger.length;

				await expect(receive(ticket._id, { 'item:milk': '11' })).rejects.toBeInstanceOf(
					StockIntegrityError
				);
				expect(opsRepo.ledger).toHaveLength(before);
			});

			it('fails closed when one item mixes an old receive and a source-lot return', async () => {
				const { ticket, lotB } = await milkTicket('8');
				opsRepo.ledger.push(
					await legacyReceiveRow(ticket._id, 'item:milk', '6'),
					createStockLedger(
						{
							item_id: 'item:milk',
							qty: '2',
							unit: 'piece',
							reason: 'distribution_return',
							ref_id: ticket._id,
							lot_ref: lotB
						},
						WH_CTX,
						await deriveDeterministicLedgerId('warehouse_return', ticket._id, 'item:milk', lotB)
					)
				);

				await expect(receive(ticket._id, { 'item:milk': '8' })).rejects.toBeInstanceOf(
					StockIntegrityError
				);
			});

			it('writes the rows a completed ticket is still missing', async () => {
				const { ticket } = await receivedOnce();
				const expected = shape(returnRows(ticket._id));
				const [, dropped] = returnRows(ticket._id);
				opsRepo.ledger = opsRepo.ledger.filter((row) => row._id !== dropped._id);

				const retry = await receive(ticket._id, { 'item:milk': '11' });

				expect(retry.ledgerEntriesCreated).toBe(1);
				expect(retry.ticket.status).toBe('RETURN_COMPLETED');
				expect(shape(returnRows(ticket._id))).toHaveLength(expected.length);
			});

			it('finishes a stopped receipt before completing the ticket', async () => {
				const { ticket } = await receivedOnce();
				const expected = returnRows(ticket._id).length;
				const [, dropped] = returnRows(ticket._id);
				opsRepo.ledger = opsRepo.ledger.filter((row) => row._id !== dropped._id);

				const completed = await completeTicket(ticket._id, WH_CTX, {
					ticketRepo,
					operationsRepo: opsRepo as unknown as OperationsRepository,
					catalogRepo: catalogWith()
				});

				expect(completed.status).toBe('COMPLETED');
				expect(returnRows(ticket._id)).toHaveLength(expected);
			});

			it('does not complete a ticket whose rows contradict its counts', async () => {
				const { ticket } = await receivedOnce();
				returnRows(ticket._id)[1].qty = '3';

				await expect(
					completeTicket(ticket._id, WH_CTX, {
						ticketRepo,
						operationsRepo: opsRepo as unknown as OperationsRepository,
						catalogRepo: catalogWith()
					})
				).rejects.toBeInstanceOf(StockIntegrityError);
				expect(ticketRepo.tickets.get(ticket._id)!.status).toBe('RETURN_COMPLETED');
			});

			it('fails closed on a zero count that already has a row', async () => {
				const { ticket, lotA } = await milkTicket('0');
				opsRepo.ledger.push(
					createStockLedger(
						{
							item_id: 'item:milk',
							qty: '3',
							unit: 'piece',
							reason: 'distribution_return',
							ref_id: ticket._id,
							lot_ref: lotA
						},
						WH_CTX,
						await deriveDeterministicLedgerId('warehouse_return', ticket._id, 'item:milk')
					)
				);

				await expect(receive(ticket._id, { 'item:milk': '0' })).rejects.toBeInstanceOf(
					StockIntegrityError
				);
			});

			describe('two receipts of one ticket with different counts', () => {
				const total = (ticketId: string) =>
					returnRows(ticketId).reduce((sum, row) => sum + Number(row.qty), 0);

				it('refuses the second once the first has completed the ticket and started writing', async () => {
					const { ticket } = await milkTicket('11');
					const write = opsRepo.addLedgerEntry.bind(opsRepo);
					let second: Promise<unknown> | undefined;
					opsRepo.addLedgerEntry = async (entry: StockLedger) => {
						const saved = await write(entry);
						second ??= receive(ticket._id, { 'item:milk': '6' });
						await second.catch(() => undefined);
						return saved;
					};

					await receive(ticket._id, { 'item:milk': '8' });

					await expect(second).rejects.toBeInstanceOf(StockIntegrityError);
					expect(total(ticket._id)).toBe(8);
					expect(ticketRepo.tickets.get(ticket._id)!.items[0].returned_qty).toBe('8');
				});

				it('refuses the first when the second completes the ticket before it', async () => {
					const { ticket } = await milkTicket('11');
					const transition = ticketRepo.transitionTicket.bind(ticketRepo);
					let first = true;
					ticketRepo.transitionTicket = async (...args) => {
						if (first) {
							first = false;
							await receive(ticket._id, { 'item:milk': '6' });
						}
						return transition(...args);
					};

					await expect(receive(ticket._id, { 'item:milk': '8' })).rejects.toBeInstanceOf(
						StockIntegrityError
					);
					expect(total(ticket._id)).toBe(6);
					expect(ticketRepo.tickets.get(ticket._id)!.items[0].returned_qty).toBe('6');
				});

				it("lets a same-count loser finish the winner's rows", async () => {
					const { ticket } = await milkTicket('11');
					const transition = ticketRepo.transitionTicket.bind(ticketRepo);
					let first = true;
					ticketRepo.transitionTicket = async (...args) => {
						if (first) {
							first = false;
							opsRepo.failItemIdOnce = 'item:milk';
							await expect(receive(ticket._id, { 'item:milk': '11' })).rejects.toThrow(
								'simulated write failure'
							);
						}
						return transition(...args);
					};

					const result = await receive(ticket._id, { 'item:milk': '11' });

					expect(result.ticket.status).toBe('RETURN_COMPLETED');
					expect(total(ticket._id)).toBe(11);
				});
			});

			it("makes a pre-CR-208 client's retry collide with the first row", async () => {
				const { ticket } = await receivedOnce();
				const oldClientRow = await legacyReceiveRow(ticket._id, 'item:milk', '11');

				await expect(
					(opsRepo as unknown as OperationsRepository).addLedgerEntry(oldClientRow)
				).rejects.toBeInstanceOf(ConflictError);
				const existing = await opsRepo.getLedgerEntry(oldClientRow._id);
				expect(existing?.reason).toBe('distribution_return');
				expect(returnRows(ticket._id).filter((row) => row.reason === 'receive')).toHaveLength(1);
			});

			it.each([['RETURN_PENDING_RECEIPT'], ['RETURN_COMPLETED']] as const)(
				'replays a ticket received before CR-208 from %s without new rows',
				async (status) => {
					const { ticket } = await milkTicket('8');
					opsRepo.ledger.push(await legacyReceiveRow(ticket._id, 'item:milk', '8'));
					const pending = ticketRepo.tickets.get(ticket._id)!;
					pending.status = status;
					pending.items[0].discrepancy_qty = '0';

					const result = await receive(ticket._id, { 'item:milk': '8' });

					expect(result.ledgerEntriesCreated).toBe(0);
					expect(shape(returnRows(ticket._id))).toEqual([
						{ reason: 'receive', lot_ref: returnRows(ticket._id)[0].lot_ref, qty: '8' }
					]);
					expect(result.ticket.status).toBe('RETURN_COMPLETED');
				}
			);
		});
	});
});
