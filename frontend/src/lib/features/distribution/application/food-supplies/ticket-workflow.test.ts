import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ulid } from '$lib/db/ulid';
import type { AuthorContext } from '$lib/db/model';
import type {
	Flow2RequisitionTicket,
	RequisitionTicket,
	RequisitionTicketInput,
	RequisitionTicketStatus
} from '../../domain/food-supplies';
import type { RequisitionTicketRepository } from '../../data/food-supplies';
import {
	allocateTicketItems,
	approveTicketForDispatch,
	cancelTicket,
	createRequisitionTicket,
	receiveTicketAtDistributionPoint
} from './ticket-workflow';

class InMemoryTicketRepository implements RequisitionTicketRepository {
	private tickets = new Map<string, RequisitionTicket>();

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
			status: 'PENDING_PICK' as const,
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
		toStatus: RequisitionTicketStatus,
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

describe('ticket-workflow', () => {
	let repo: InMemoryTicketRepository;
	const WH_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'wh_user',
		roles: ['shelter:SH001', 'warehouse_staff']
	};
	const MGR_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'mgr_user',
		roles: ['shelter:SH001', 'shelter_manager']
	};
	const POS_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'pos_user',
		roles: ['shelter:SH001', 'registration_staff']
	};
	const UNAUTH_CTX: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'vol_user',
		roles: ['shelter:SH001', 'medical_staff']
	};

	beforeEach(() => {
		repo = new InMemoryTicketRepository();
	});

	it('creates valid food requisition ticket in PENDING_PICK', async () => {
		const ticket = await createRequisitionTicket(
			{
				ticket_no: 'TKT-FOOD-0001',
				requisition_type: 'food',
				meal: 'lunch',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:meal1',
						item_name: 'Chicken Rice',
						category: 'item_category:ready_meal',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '100',
						allocated_qty: '100'
					}
				]
			},
			WH_CTX,
			repo
		);

		expect(ticket.status).toBe('PENDING_PICK');
		expect(ticket.requisition_type).toBe('food');
		expect(ticket.meal).toBe('lunch');
	});

	it('creates valid supplies requisition ticket in PENDING_PICK', async () => {
		const ticket = await createRequisitionTicket(
			{
				ticket_no: 'TKT-SUPPLIES-0001',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:supplies_1',
				items: [
					{
						item_id: 'item:fan1',
						item_name: 'Electric Fan',
						type_class: 'EQUIPMENT',
						returnable: true,
						requested_qty: '20',
						allocated_qty: '20'
					}
				]
			},
			WH_CTX,
			repo
		);

		expect(ticket.status).toBe('PENDING_PICK');
		expect(ticket.requisition_type).toBe('supplies');
	});

	it('rejects out of scope requisition types (kitchen, transfer)', async () => {
		await expect(
			createRequisitionTicket(
				{
					ticket_no: 'TKT-FOOD-0001',
					requisition_type: 'kitchen' as unknown as 'food',
					source_location: 'warehouse:main',
					destination_location: 'kitchen',
					items: [
						{
							item_id: 'item:rice',
							item_name: 'Rice',
							type_class: 'CONSUMABLE',
							returnable: false,
							requested_qty: '50',
							allocated_qty: '50'
						}
					]
				},
				WH_CTX,
				repo
			)
		).rejects.toThrow(/Invalid requisition_type/);
	});

	it('rejects creation from unauthorized actor', async () => {
		await expect(
			createRequisitionTicket(
				{
					ticket_no: 'TKT-FOOD-0001',
					requisition_type: 'food',
					meal: 'lunch',
					source_location: 'warehouse:main',
					destination_location: 'point:a',
					items: [
						{
							item_id: 'item:meal1',
							item_name: 'Meal',
							type_class: 'CONSUMABLE',
							returnable: false,
							requested_qty: '10',
							allocated_qty: '10'
						}
					]
				},
				UNAUTH_CTX,
				repo
			)
		).rejects.toThrow(/Unauthorized/);
	});

	it('allocates picked items on ticket in PENDING_PICK', async () => {
		const ticket = await createRequisitionTicket(
			{
				ticket_no: 'TKT-FOOD-0001',
				requisition_type: 'food',
				meal: 'dinner',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:meal1',
						item_name: 'Meal',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '100',
						allocated_qty: '100'
					}
				]
			},
			WH_CTX,
			repo
		);

		const updated = await allocateTicketItems(
			ticket._id,
			[
				{
					item_id: 'item:meal1',
					allocated_qty: '95',
					lot_ref: 'stock_ledger:01JLOT00000000000000000001'
				}
			],
			WH_CTX,
			repo
		);

		expect(updated.items[0].allocated_qty).toBe('95');
	});

	it('approves ticket by manager transitioning to READY_FOR_DISPATCH', async () => {
		const ticket = await createRequisitionTicket(
			{
				ticket_no: 'TKT-SUPPLIES-0001',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:b',
				items: [
					{
						item_id: 'item:mat',
						item_name: 'Sleeping Mat',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '50',
						allocated_qty: '50'
					}
				]
			},
			WH_CTX,
			repo
		);

		await allocateTicketItems(
			ticket._id,
			[{ item_id: 'item:mat', allocated_qty: '50' }],
			WH_CTX,
			repo
		);

		// Warehouse staff cannot approve (AC-TKT-03.1)
		await expect(approveTicketForDispatch(ticket._id, WH_CTX, repo)).rejects.toThrow(
			/Unauthorized/
		);

		// Manager can approve
		const approved = await approveTicketForDispatch(ticket._id, MGR_CTX, repo);
		expect(approved.status).toBe('READY_FOR_DISPATCH');
		expect(approved.approved_by).toBe(MGR_CTX.createdBy);
	});

	it('rejects approval when items are unallocated', async () => {
		const ticket = await createRequisitionTicket(
			{
				ticket_no: 'TKT-SUPPLIES-0001',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'point:b',
				items: [
					{
						item_id: 'item:mat',
						item_name: 'Sleeping Mat',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '50',
						allocated_qty: '50'
					}
				]
			},
			WH_CTX,
			repo
		);

		// Mutate allocated_qty to '0' to test validation
		await repo.mutateTicketCAS(
			ticket._id,
			(t) => ({ ...t, items: [{ ...t.items[0], allocated_qty: '0' }] }),
			MGR_CTX
		);

		await expect(approveTicketForDispatch(ticket._id, MGR_CTX, repo)).rejects.toThrow(
			/must have positive allocated_qty/
		);
	});

	it('receives ticket at distribution point transitioning IN_TRANSIT to DISTRIBUTING', async () => {
		const ticket = await createRequisitionTicket(
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
						requested_qty: '10',
						allocated_qty: '10'
					}
				]
			},
			WH_CTX,
			repo
		);

		await repo.transitionTicket(ticket._id, 'IN_TRANSIT', WH_CTX, { dispatched_by: 'wh_user' });

		const received = await receiveTicketAtDistributionPoint(ticket._id, POS_CTX, repo);
		expect(received.status).toBe('DISTRIBUTING');
		expect(received.received_by).toBe(POS_CTX.createdBy);
	});

	it('allows cancellation only for pre-dispatch tickets', async () => {
		const ticket = await createRequisitionTicket(
			{
				ticket_no: 'TKT-FOOD-0001',
				requisition_type: 'food',
				meal: 'breakfast',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:porridge',
						item_name: 'Porridge',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '40',
						allocated_qty: '40'
					}
				]
			},
			WH_CTX,
			repo
		);

		const cancelled = await cancelTicket(
			ticket._id,
			'Meal cancelled due to kitchen delay',
			WH_CTX,
			repo
		);
		expect(cancelled.status).toBe('CANCELLED');
	});

	it('rejects item allocation from unauthorized actor and does not mutate repository', async () => {
		const ticket = await createRequisitionTicket(
			{
				ticket_no: 'TKT-FOOD-0001',
				requisition_type: 'food',
				meal: 'dinner',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:meal1',
						item_name: 'Meal',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '100',
						allocated_qty: '100'
					}
				]
			},
			WH_CTX,
			repo
		);

		const mutateSpy = vi.spyOn(repo, 'mutateTicketCAS');

		// registration_staff is frontline only, unauthorized for warehouse allocation
		await expect(
			allocateTicketItems(
				ticket._id,
				[{ item_id: 'item:meal1', allocated_qty: '80' }],
				POS_CTX,
				repo
			)
		).rejects.toThrow(/Unauthorized/);

		// medical_staff is unauthorized
		await expect(
			allocateTicketItems(
				ticket._id,
				[{ item_id: 'item:meal1', allocated_qty: '80' }],
				UNAUTH_CTX,
				repo
			)
		).rejects.toThrow(/Unauthorized/);

		expect(mutateSpy).not.toHaveBeenCalled();

		const untouched = await repo.get(ticket._id);
		expect(untouched?.items[0].allocated_qty).toBe('100');
	});

	it('rejects ticket cancellation from unauthorized actor and does not transition ticket', async () => {
		const ticket = await createRequisitionTicket(
			{
				ticket_no: 'TKT-FOOD-0001',
				requisition_type: 'food',
				meal: 'dinner',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:meal1',
						item_name: 'Meal',
						type_class: 'CONSUMABLE',
						returnable: false,
						requested_qty: '100',
						allocated_qty: '100'
					}
				]
			},
			WH_CTX,
			repo
		);

		const transitionSpy = vi.spyOn(repo, 'transitionTicket');

		// registration_staff cannot cancel warehouse tickets
		await expect(
			cancelTicket(ticket._id, 'Unauthorized cancel attempt', POS_CTX, repo)
		).rejects.toThrow(/Unauthorized/);

		// medical_staff cannot cancel warehouse tickets
		await expect(
			cancelTicket(ticket._id, 'Unauthorized cancel attempt', UNAUTH_CTX, repo)
		).rejects.toThrow(/Unauthorized/);

		expect(transitionSpy).not.toHaveBeenCalled();

		const untouched = await repo.get(ticket._id);
		expect(untouched?.status).toBe('PENDING_PICK');
	});

	describe('Positive whole number quantity enforcement (Slice 5.1/5.7)', () => {
		it('rejects creating a ticket with fractional requested_qty', async () => {
			await expect(
				createRequisitionTicket(
					{
						ticket_no: 'TKT-FOOD-0001',
						requisition_type: 'food',
						meal: 'lunch',
						source_location: 'warehouse:main',
						destination_location: 'point:a',
						items: [
							{
								item_id: 'item:meal1',
								item_name: 'Meal',
								type_class: 'CONSUMABLE',
								requested_qty: '1.5',
								allocated_qty: '1.5'
							}
						]
					},
					WH_CTX,
					repo
				)
			).rejects.toThrow(/must be a positive whole number/);
		});

		it('rejects creating a ticket with scientific notation requested_qty', async () => {
			await expect(
				createRequisitionTicket(
					{
						ticket_no: 'TKT-FOOD-0001',
						requisition_type: 'food',
						meal: 'lunch',
						source_location: 'warehouse:main',
						destination_location: 'point:a',
						items: [
							{
								item_id: 'item:meal1',
								item_name: 'Meal',
								type_class: 'CONSUMABLE',
								requested_qty: '1e2',
								allocated_qty: '1e2'
							}
						]
					},
					WH_CTX,
					repo
				)
			).rejects.toThrow(/must be a positive whole number/);
		});

		it('rejects allocating fractional quantity to an item', async () => {
			const ticket = await createRequisitionTicket(
				{
					ticket_no: 'TKT-FOOD-0001',
					requisition_type: 'food',
					meal: 'dinner',
					source_location: 'warehouse:main',
					destination_location: 'point:a',
					items: [
						{
							item_id: 'item:meal1',
							item_name: 'Meal',
							type_class: 'CONSUMABLE',
							requested_qty: '50',
							allocated_qty: '50'
						}
					]
				},
				WH_CTX,
				repo
			);

			await expect(
				allocateTicketItems(
					ticket._id,
					[{ item_id: 'item:meal1', allocated_qty: '2.25' }],
					WH_CTX,
					repo
				)
			).rejects.toThrow(/must be a positive whole number/);
		});
	});
});
