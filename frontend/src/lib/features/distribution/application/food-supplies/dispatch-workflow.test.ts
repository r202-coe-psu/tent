import { describe, it, expect, beforeEach } from 'vitest';
import { ulid } from '$lib/db/ulid';
import type { AuthorContext } from '$lib/db/model';
import type {
	Flow2RequisitionTicket,
	RequisitionTicket,
	RequisitionTicketInput
} from '../../domain/food-supplies';
import type { RequisitionTicketRepository } from '../../data/food-supplies';
import type { OperationsRepository, StockLedger } from '$lib/features/operations';
import { amendActiveTicket, dispatchTicket } from './dispatch-workflow';

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
			status: 'READY_FOR_DISPATCH' as const,
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

class InMemoryOperationsRepository implements Partial<OperationsRepository> {
	ledger: StockLedger[] = [];

	async addLedgerEntry(entry: StockLedger): Promise<StockLedger> {
		this.ledger.push(entry);
		return entry;
	}

	async listLedger(): Promise<StockLedger[]> {
		return [...this.ledger];
	}

	async listLedgerByItem(itemId: string): Promise<StockLedger[]> {
		return this.ledger.filter((l) => l.item_id === itemId);
	}
}

describe('dispatch-workflow', () => {
	let ticketRepo: InMemoryTicketRepository;
	let opsRepo: InMemoryOperationsRepository;
	const WH_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'wh_user',
		roles: ['shelter:SH001', 'warehouse_staff']
	};
	const SC_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'sc_user',
		roles: ['shelter:SH001', 'supply_coordinator']
	};
	const UNAUTH_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'med_user',
		roles: ['shelter:SH001', 'medical_staff']
	};

	beforeEach(() => {
		ticketRepo = new InMemoryTicketRepository();
		opsRepo = new InMemoryOperationsRepository();
	});

	it('dispatches multi-item ticket with exact negative stock ledger entries and lot_ref', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-FOOD-0001',
				requisition_type: 'food',
				meal: 'lunch',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:curry',
						item_name: 'Chicken Curry',
						category: 'item_category:ready_meal',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '50',
						allocated_qty: '50'
					},
					{
						item_id: 'item:water',
						item_name: 'Water Bottle',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '100',
						allocated_qty: '100'
					}
				]
			},
			WH_CTX
		);

		const result = await dispatchTicket(
			ticket._id,
			{
				driver_name: 'Somchai',
				license_plate: '1AB-1234',
				item_lots: {
					'item:curry': 'stock_ledger:01JLOTCURRY000000000000000',
					'item:water': 'stock_ledger:01JLOTWATER000000000000000'
				}
			},
			WH_CTX,
			{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
		);

		expect(result.ticket.status).toBe('IN_TRANSIT');
		expect(result.ticket.dispatched_by).toBe(WH_CTX.createdBy);
		expect(result.ticket.driver_name).toBe('Somchai');
		expect(result.ticket.license_plate).toBe('1AB-1234');
		expect(result.ledgerEntriesCreated).toBe(2);

		// Assert StockLedger entries
		expect(opsRepo.ledger).toHaveLength(2);
		const curryEntry = opsRepo.ledger.find((l) => l.item_id === 'item:curry')!;
		expect(curryEntry.reason).toBe('distribute');
		expect(curryEntry.ref_id).toBe(ticket._id);
		expect(curryEntry.qty).toBe('-50');
		expect(curryEntry.lot_ref).toBe('stock_ledger:01JLOTCURRY000000000000000');

		const waterEntry = opsRepo.ledger.find((l) => l.item_id === 'item:water')!;
		expect(waterEntry.reason).toBe('distribute');
		expect(waterEntry.ref_id).toBe(ticket._id);
		expect(waterEntry.qty).toBe('-100');
	});

	it('authorizes supply_coordinator for ticket dispatch (CR-121 FR-SEC-01 Step 3)', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-0001',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:b',
				items: [
					{
						item_id: 'item:blanket',
						item_name: 'Blanket',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '25',
						allocated_qty: '25'
					}
				]
			},
			WH_CTX
		);

		const result = await dispatchTicket(ticket._id, undefined, SC_CTX, {
			ticketRepo,
			operationsRepo: opsRepo as unknown as OperationsRepository
		});

		expect(result.ticket.status).toBe('IN_TRANSIT');
		expect(result.ticket.dispatched_by).toBe(SC_CTX.createdBy);
	});

	it('rejects dispatch from unauthorized role', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-0002',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:b',
				items: [
					{
						item_id: 'item:blanket',
						item_name: 'Blanket',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '25',
						allocated_qty: '25'
					}
				]
			},
			WH_CTX
		);

		await expect(
			dispatchTicket(ticket._id, undefined, UNAUTH_CTX, {
				ticketRepo,
				operationsRepo: opsRepo as unknown as OperationsRepository
			})
		).rejects.toThrow(/Unauthorized/);
	});

	it('does not duplicate ledger entries on dispatch retry', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-FOOD-0002',
				requisition_type: 'food',
				meal: 'lunch',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:soup',
						item_name: 'Soup',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '30',
						allocated_qty: '30'
					}
				]
			},
			WH_CTX
		);

		// First dispatch succeeds
		await dispatchTicket(ticket._id, undefined, WH_CTX, {
			ticketRepo,
			operationsRepo: opsRepo as unknown as OperationsRepository
		});
		expect(opsRepo.ledger).toHaveLength(1);

		// Reset ticket status to READY_FOR_DISPATCH to simulate retry after network blip
		ticketRepo.tickets.get(ticket._id)!.status = 'READY_FOR_DISPATCH';

		// Second dispatch retry
		const retryResult = await dispatchTicket(ticket._id, undefined, WH_CTX, {
			ticketRepo,
			operationsRepo: opsRepo as unknown as OperationsRepository
		});
		expect(retryResult.ledgerEntriesCreated).toBe(0); // Detected existing ledger row
		expect(opsRepo.ledger).toHaveLength(1); // No duplicate ledger entry
	});

	it('amends active ticket with in-flight top-up deduction and amendment record', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-FOOD-0003',
				requisition_type: 'food',
				meal: 'lunch',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:soup',
						item_name: 'Soup',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '30',
						allocated_qty: '30'
					}
				]
			},
			WH_CTX
		);

		// Move to DISTRIBUTING
		ticketRepo.tickets.get(ticket._id)!.status = 'DISTRIBUTING';

		const amended = await amendActiveTicket(
			ticket._id,
			{ item_id: 'item:soup', added_qty: '20', reason: 'Emergency bus arrived' },
			WH_CTX,
			{ ticketRepo, operationsRepo: opsRepo as unknown as OperationsRepository }
		);

		expect(amended.items[0].allocated_qty).toBe('50'); // 30 + 20
		expect(amended.amendments).toHaveLength(1);
		expect(amended.amendments![0].added_qty).toBe('20');
		expect(amended.amendments![0].reason).toBe('Emergency bus arrived');

		// In-flight outbound stock deduction written
		const amendmentLedger = opsRepo.ledger[opsRepo.ledger.length - 1];
		expect(amendmentLedger.reason).toBe('distribute');
		expect(amendmentLedger.qty).toBe('-20');
		expect(amendmentLedger.ref_id).toBe(ticket._id);
	});
});
