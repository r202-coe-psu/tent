import { describe, it, expect, beforeEach } from 'vitest';
import { ulid } from '$lib/db/ulid';
import type { AuthorContext } from '$lib/db/model';
import type {
	DistributionLog,
	DistributionLogInput,
	Flow2RequisitionTicket,
	RequisitionTicket,
	RequisitionTicketInput
} from '../../domain/food-supplies';
import { createDistributionLog } from '../../domain/food-supplies';
import type {
	DistributionLogListFilter,
	DistributionLogRepository,
	RequisitionTicketRepository
} from '../../data/food-supplies';
import type { OperationsRepository, StockLedger } from '$lib/features/operations';
import {
	calculateShiftReconciliation,
	closeShift,
	receiveWarehouseReturns,
	submitReturnsToWarehouse
} from './reconciliation-workflow';

class InMemoryTicketRepository implements RequisitionTicketRepository {
	tickets = new Map<string, RequisitionTicket>();

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
		const current = this.tickets.get(ticketId);
		if (!current) throw new Error('Not found');
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

	async list(filter?: DistributionLogListFilter): Promise<DistributionLog[]> {
		return Array.from(this.logs.values()).filter((l) => {
			if (filter?.ticket_id && l.ticket_id !== filter.ticket_id) return false;
			if (filter?.item_id && l.item_id !== filter.item_id) return false;
			return true;
		});
	}
}

class InMemoryOperationsRepository implements Partial<OperationsRepository> {
	ledger: StockLedger[] = [];

	async addLedgerEntry(entry: StockLedger): Promise<StockLedger> {
		this.ledger.push(entry);
		return entry;
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
		roles: ['shelter:SH001', 'registration_staff']
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

		// Inbound stock ledger written
		expect(opsRepo.ledger).toHaveLength(1);
		const ledger = opsRepo.ledger[0];
		expect(ledger.reason).toBe('receive');
		expect(ledger.ref_id).toBe(ticket._id);
		expect(ledger.qty).toBe('4');
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
		).rejects.toThrow(/non-negative decimal string/);
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
		expect(opsRepo.ledger.map((entry) => entry.item_id).sort()).toEqual([
			'item:blanket',
			'item:mat'
		]);
		expect(result.ticket.items[1].discrepancy_qty).toBe('1');
	});
});
