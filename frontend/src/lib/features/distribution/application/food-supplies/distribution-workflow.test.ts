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
	RecordReturnInput,
	RecordClearInput,
	RequisitionTicketRepository
} from '../../data/food-supplies';
import {
	recordFoodDistribution,
	recordSuppliesDistribution,
	voidDistributionLog
} from './distribution-workflow';

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

class InMemoryLogRepository implements DistributionLogRepository {
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
		this.logs.set(doc._id, doc);
		return doc;
	}

	async get(logId: string): Promise<DistributionLog | null> {
		return this.logs.get(logId) ?? null;
	}

	async list(filter?: DistributionLogListFilter): Promise<DistributionLog[]> {
		return Array.from(this.logs.values()).filter((l) => {
			if (filter?.ticket_id && l.ticket_id !== filter.ticket_id) return false;
			if (filter?.item_id && l.item_id !== filter.item_id) return false;
			if (filter?.recipient_id && l.recipient_id !== filter.recipient_id) return false;
			return true;
		});
	}

	async mutateLogCAS(
		logId: string,
		mutator: (current: DistributionLog) => DistributionLog
	): Promise<DistributionLog> {
		const current = this.logs.get(logId);
		if (!current) throw new Error('Not found');
		const updated = mutator(current);
		this.logs.set(logId, updated);
		return updated;
	}

	async recordReturn(
		logId: string,
		input: RecordReturnInput,
		ctx: AuthorContext
	): Promise<DistributionLog> {
		return this.mutateLogCAS(logId, (l) => ({
			...l,
			status: input.qty_returned === l.qty ? 'returned' : 'partially_returned',
			qty_returned: input.qty_returned,
			clear_reason: input.clear_reason,
			condition_on_return: input.condition_on_return,
			bulk_pool_id: input.bulk_pool_id,
			returned_at: new Date().toISOString(),
			returned_by: ctx.createdBy
		}));
	}

	async recordClear(
		logId: string,
		input: RecordClearInput,
		ctx: AuthorContext
	): Promise<DistributionLog> {
		return this.mutateLogCAS(logId, (l) => ({
			...l,
			status: input.clear_reason,
			clear_reason: input.clear_reason,
			returned_at: new Date().toISOString(),
			returned_by: ctx.createdBy,
			notes: input.notes
		}));
	}

	async recordVoid(logId: string, ctx: AuthorContext, notes?: string): Promise<DistributionLog> {
		return this.mutateLogCAS(logId, (l) => ({
			...l,
			status: 'voided',
			voided_at: new Date().toISOString(),
			voided_by: ctx.createdBy,
			notes
		}));
	}
}

describe('distribution-workflow', () => {
	let ticketRepo: InMemoryTicketRepository;
	let logRepo: InMemoryLogRepository;
	const POS_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'pos_user',
		roles: ['shelter:SH001', 'registration_staff']
	};

	beforeEach(() => {
		ticketRepo = new InMemoryTicketRepository();
		logRepo = new InMemoryLogRepository();
	});

	it('records food handover without mutating requisition_ticket document (AC-DST-02.2)', async () => {
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
						item_name: 'Curry',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '50',
						allocated_qty: '50'
					}
				]
			},
			POS_CTX
		);

		const log = await recordFoodDistribution(
			ticket._id,
			{
				item_id: 'item:curry',
				qty: '2',
				recipient_type: 'evacuee',
				recipient_id: 'evacuee:01JEVACUEE0000000000000001'
			},
			POS_CTX,
			{ ticketRepo, logRepo }
		);

		expect(log.status).toBe('fulfilled');
		expect(log.is_returnable).toBe(false);
		expect(log.qty).toBe('2');
		expect(log.ticket_id).toBe(ticket._id);

		// Assert ticket is not mutated
		const freshTicket = await ticketRepo.get(ticket._id);
		expect(freshTicket?.items[0].distributed_qty).toBeUndefined();
	});

	it('enforces in-hand capacity limits', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-FOOD-0002',
				requisition_type: 'food',
				meal: 'dinner',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:rice',
						item_name: 'Rice',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '3',
						allocated_qty: '3'
					}
				]
			},
			POS_CTX
		);

		// Distribute 2
		await recordFoodDistribution(
			ticket._id,
			{ item_id: 'item:rice', qty: '2', recipient_type: 'outside' },
			POS_CTX,
			{ ticketRepo, logRepo }
		);

		// Attempting to distribute 2 more (when only 1 in-hand remaining) throws CapacityExceededError
		await expect(
			recordFoodDistribution(
				ticket._id,
				{ item_id: 'item:rice', qty: '2', recipient_type: 'outside' },
				POS_CTX,
				{ ticketRepo, logRepo }
			)
		).rejects.toThrow(/Insufficient in-hand quantity/);
	});

	it('detects duplicate meal for recipient and requires override', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-FOOD-0003',
				requisition_type: 'food',
				meal: 'lunch',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:curry',
						item_name: 'Curry',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					}
				]
			},
			POS_CTX
		);

		// First distribution
		await recordFoodDistribution(
			ticket._id,
			{
				item_id: 'item:curry',
				qty: '1',
				recipient_type: 'evacuee',
				recipient_id: 'evacuee:01JEVACUEE0000000000000002'
			},
			POS_CTX,
			{ ticketRepo, logRepo }
		);

		// Duplicate distribution in same meal without override rejected
		await expect(
			recordFoodDistribution(
				ticket._id,
				{
					item_id: 'item:curry',
					qty: '1',
					recipient_type: 'evacuee',
					recipient_id: 'evacuee:01JEVACUEE0000000000000002'
				},
				POS_CTX,
				{ ticketRepo, logRepo }
			)
		).rejects.toThrow(/already received a meal/);

		// With override accepted
		const overrideLog = await recordFoodDistribution(
			ticket._id,
			{
				item_id: 'item:curry',
				qty: '1',
				recipient_type: 'evacuee',
				recipient_id: 'evacuee:01JEVACUEE0000000000000002',
				is_override: true,
				override_reason: 'Extra meal for visiting family elder'
			},
			POS_CTX,
			{ ticketRepo, logRepo }
		);
		expect(overrideLog.is_override).toBe(true);
	});

	it('scopes food entitlement to the Thailand calendar day and ignores voided logs', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-FOOD-0005',
				requisition_type: 'food',
				meal: 'lunch',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:curry',
						item_name: 'Curry',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					},
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
		const recipientId = 'evacuee:01JEVACUEE0000000000000005';
		await logRepo.create(
			{
				ticket_id: ticket._id,
				item_id: 'item:curry',
				qty: '1',
				recipient_type: 'evacuee',
				recipient_id: recipientId,
				meal: 'lunch',
				is_returnable: false,
				is_override: false,
				distributed_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
			},
			POS_CTX
		);

		await expect(
			recordFoodDistribution(
				ticket._id,
				{ item_id: 'item:curry', qty: '1', recipient_type: 'evacuee', recipient_id: recipientId },
				POS_CTX,
				{ ticketRepo, logRepo }
			)
		).resolves.toMatchObject({ status: 'fulfilled' });
		await expect(
			recordFoodDistribution(
				ticket._id,
				{ item_id: 'item:rice', qty: '1', recipient_type: 'evacuee', recipient_id: recipientId },
				POS_CTX,
				{ ticketRepo, logRepo }
			)
		).rejects.toThrow(/already received a meal/);

		const voidedRecipientId = 'evacuee:01JEVACUEE0000000000000006';
		const voided = createDistributionLog(
			{
				ticket_id: ticket._id,
				item_id: 'item:curry',
				qty: '1',
				recipient_type: 'evacuee',
				recipient_id: voidedRecipientId,
				meal: 'lunch',
				is_returnable: false,
				is_override: false
			},
			POS_CTX
		);
		await logRepo.create(
			{
				...voided,
				status: 'voided',
				voided_at: new Date().toISOString(),
				voided_by: POS_CTX.createdBy
			},
			POS_CTX
		);
		await expect(
			recordFoodDistribution(
				ticket._id,
				{
					item_id: 'item:curry',
					qty: '1',
					recipient_type: 'evacuee',
					recipient_id: voidedRecipientId
				},
				POS_CTX,
				{ ticketRepo, logRepo }
			)
		).resolves.toMatchObject({ status: 'fulfilled' });
	});

	it('applies 4-hour soft warning flag when food exceeds safety window', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-FOOD-0004',
				requisition_type: 'food',
				meal: 'dinner',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:curry',
						item_name: 'Curry',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					}
				]
			},
			POS_CTX
		);

		const fiveHoursAgo = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
		const log = await recordFoodDistribution(
			ticket._id,
			{
				item_id: 'item:curry',
				qty: '1',
				recipient_type: 'outside',
				cooking_completed_at: fiveHoursAgo
			},
			POS_CTX,
			{ ticketRepo, logRepo }
		);

		expect(log.is_expired_warning).toBe(true);
	});

	it('records supplies consumable and returnable loans correctly', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-0001',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:supplies',
				items: [
					{
						item_id: 'item:soap',
						item_name: 'Soap',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					},
					{
						item_id: 'item:wheelchair',
						item_name: 'Wheelchair',
						type_class: 'EQUIPMENT',
						returnable: true,
						requested_qty: '5',
						allocated_qty: '5'
					}
				]
			},
			POS_CTX
		);

		// Consumable supplies
		const consumableLog = await recordSuppliesDistribution(
			ticket._id,
			{ item_id: 'item:soap', qty: '2', recipient_type: 'outside' },
			POS_CTX,
			{ ticketRepo, logRepo }
		);
		expect(consumableLog.is_returnable).toBe(false);
		expect(consumableLog.status).toBe('fulfilled');

		// Returnable loan requires recipient
		await expect(
			recordSuppliesDistribution(
				ticket._id,
				{ item_id: 'item:wheelchair', qty: '1', recipient_type: 'outside' },
				POS_CTX,
				{ ticketRepo, logRepo }
			)
		).rejects.toThrow(/identifiable recipient_id/);

		const loanLog = await recordSuppliesDistribution(
			ticket._id,
			{
				item_id: 'item:wheelchair',
				qty: '1',
				recipient_type: 'evacuee',
				recipient_id: 'evacuee:01JEVACUEE0000000000000003'
			},
			POS_CTX,
			{ ticketRepo, logRepo }
		);
		expect(loanLog.is_returnable).toBe(true);
		expect(loanLog.status).toBe('active');
	});

	it('voids erroneous distribution log without deleting document', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-0002',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:supplies',
				items: [
					{
						item_id: 'item:soap',
						item_name: 'Soap',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '10',
						allocated_qty: '10'
					}
				]
			},
			POS_CTX
		);

		const log = await recordSuppliesDistribution(
			ticket._id,
			{ item_id: 'item:soap', qty: '1', recipient_type: 'outside' },
			POS_CTX,
			{ ticketRepo, logRepo }
		);

		const voided = await voidDistributionLog(log._id, 'Duplicate tap error', POS_CTX, logRepo);
		expect(voided.status).toBe('voided');
		expect(voided.voided_by).toBe(POS_CTX.createdBy);
	});

	it('allows voiding an untouched active loan but rejects loans with return or clear activity', async () => {
		const ticket = await ticketRepo.create(
			{
				ticket_no: 'TKT-SUPPLIES-0003',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:supplies',
				items: [
					{
						item_id: 'item:wheelchair',
						item_name: 'Wheelchair',
						type_class: 'EQUIPMENT',
						returnable: true,
						requested_qty: '5',
						allocated_qty: '5'
					}
				]
			},
			POS_CTX
		);
		const loanInput = (recipient_id: string) => ({
			item_id: 'item:wheelchair',
			qty: '1',
			recipient_type: 'evacuee' as const,
			recipient_id
		});
		const active = await recordSuppliesDistribution(
			ticket._id,
			loanInput('evacuee:01JEVACUEE0000000000000010'),
			POS_CTX,
			{ ticketRepo, logRepo }
		);
		await expect(
			voidDistributionLog(active._id, 'Wrong scan', POS_CTX, logRepo)
		).resolves.toMatchObject({
			status: 'voided'
		});

		const partial = await recordSuppliesDistribution(
			ticket._id,
			loanInput('evacuee:01JEVACUEE0000000000000011'),
			POS_CTX,
			{ ticketRepo, logRepo }
		);
		await logRepo.recordReturn(
			partial._id,
			{ qty_returned: '1', clear_reason: 'routine' },
			POS_CTX
		);
		await expect(voidDistributionLog(partial._id, 'Too late', POS_CTX, logRepo)).rejects.toThrow(
			/after.*return|resolution state/
		);

		const returned = await recordSuppliesDistribution(
			ticket._id,
			loanInput('evacuee:01JEVACUEE0000000000000012'),
			POS_CTX,
			{ ticketRepo, logRepo }
		);
		await logRepo.recordReturn(
			returned._id,
			{ qty_returned: '1', clear_reason: 'routine' },
			POS_CTX
		);
		await expect(voidDistributionLog(returned._id, 'Too late', POS_CTX, logRepo)).rejects.toThrow(
			/after return or clear activity|resolution state/
		);

		const lost = await recordSuppliesDistribution(
			ticket._id,
			loanInput('evacuee:01JEVACUEE0000000000000013'),
			POS_CTX,
			{ ticketRepo, logRepo }
		);
		await logRepo.recordClear(lost._id, { clear_reason: 'lost', notes: 'Lost in flood' }, POS_CTX);
		await expect(voidDistributionLog(lost._id, 'Too late', POS_CTX, logRepo)).rejects.toThrow(
			/after return or clear activity|resolution state/
		);

		const waived = await recordSuppliesDistribution(
			ticket._id,
			loanInput('evacuee:01JEVACUEE0000000000000014'),
			POS_CTX,
			{ ticketRepo, logRepo }
		);
		await logRepo.recordClear(
			waived._id,
			{ clear_reason: 'waived', notes: 'Manager approved waiver' },
			POS_CTX
		);
		await expect(voidDistributionLog(waived._id, 'Too late', POS_CTX, logRepo)).rejects.toThrow(
			/after return or clear activity|resolution state/
		);
	});
});
