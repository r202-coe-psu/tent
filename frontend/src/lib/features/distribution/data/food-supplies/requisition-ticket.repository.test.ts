// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import {
	RequisitionTicketRemoteRepository,
	type RequisitionTicketRepository
} from './requisition-ticket.repository';

interface InMemoryDoc {
	_id: string;
	_rev?: string;
	type?: string;
	[key: string]: unknown;
}

let store: Map<string, InMemoryDoc>;
let revCounters: Map<string, number>;
let putDocCalls: InMemoryDoc[];

function nextRev(id: string): string {
	const count = (revCounters.get(id) ?? 0) + 1;
	revCounters.set(id, count);
	return `${count}-rev${id.replace(/[^a-zA-Z0-9]/g, '')}`;
}

vi.mock('$lib/db/shelter', () => ({
	SHELTER_CODE: 'SH001',
	SHELTER_DB: 'shelter_sh001',
	getShelterDb: () => 'shelter_sh001'
}));

vi.mock('$lib/db/couch-db', async () => {
	const { ConflictError } = await import('$lib/utils/errors');
	return {
		ConflictError,
		getDoc: async <T extends { _id: string }>(_dbName: string, id: string): Promise<T | null> => {
			const doc = store.get(id);
			if (!doc) return null;
			return JSON.parse(JSON.stringify(doc)) as T;
		},
		putDoc: async <T extends { _id: string; _rev?: string }>(
			_dbName: string,
			doc: T
		): Promise<T> => {
			putDocCalls.push(JSON.parse(JSON.stringify(doc)));
			const existing = store.get(doc._id);
			if (existing) {
				if (!doc._rev || doc._rev !== existing._rev) {
					throw new ConflictError(`Conflict on doc ${doc._id}: rev mismatch`);
				}
			}
			const clone = JSON.parse(JSON.stringify(doc)) as T & { _rev: string };
			clone._rev = nextRev(doc._id);
			store.set(doc._id, clone as InMemoryDoc);
			return clone;
		},
		allDocsByType: async <T extends { _id: string; type: string }>(
			_dbName: string,
			type: string
		): Promise<T[]> => {
			const results: T[] = [];
			for (const [id, doc] of store.entries()) {
				if (id.startsWith(`${type}:`) && doc.type === type) {
					results.push(JSON.parse(JSON.stringify(doc)) as T);
				}
			}
			return results;
		}
	};
});

describe('RequisitionTicketRemoteRepository', () => {
	const ctx: AuthorContext = {
		createdBy: 'user:staff1',
		shelterCode: 'SH001',
		roles: ['warehouse_staff']
	};

	let repo: RequisitionTicketRepository;

	beforeEach(() => {
		store = new Map();
		revCounters = new Map();
		putDocCalls = [];
		repo = new RequisitionTicketRemoteRepository('SH001');
	});

	it('creates canonical Food Ticket and persists to shelter db', async () => {
		const ticket = await repo.create(
			{
				ticket_no: 'TKT-FOOD-0001',
				requisition_type: 'food',
				meal: 'lunch',
				source_location: 'warehouse:main',
				destination_location: 'distribution_point:tent_a',
				items: [
					{
						item_id: 'item:cooked_rice',
						item_name: 'Cooked Jasmine Rice',
						type_class: 'CONSUMABLE',
						requested_qty: '100',
						allocated_qty: '100'
					}
				]
			},
			ctx
		);

		expect(ticket._id).toMatch(/^requisition_ticket:[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(ticket.type).toBe('requisition_ticket');
		expect(ticket.status).toBe('PENDING_PICK');
		expect(ticket.schema_v).toBe(1);
		expect(ticket.shelter_code).toBe('SH001');
		expect(ticket.meal).toBe('lunch');

		// Assert no legacy distribution_request or batch created
		for (const key of store.keys()) {
			expect(key.startsWith('distribution_request:')).toBe(false);
			expect(key.startsWith('distribution_batch:')).toBe(false);
		}
	});

	it('creates canonical Supplies Ticket and retrieves it by ID', async () => {
		const ticket = await repo.create(
			{
				ticket_no: 'TKT-SUPPLIES-0001',
				requisition_type: 'supplies',
				source_location: 'warehouse:main',
				destination_location: 'distribution_point:tent_b',
				items: [
					{
						item_id: 'item:blanket',
						item_name: 'Wool Blanket',
						type_class: 'DURABLE',
						returnable: true,
						requested_qty: '50',
						allocated_qty: '50'
					}
				]
			},
			ctx
		);

		const fetched = await repo.get(ticket._id);
		expect(fetched).not.toBeNull();
		expect(fetched?._id).toBe(ticket._id);
		expect(fetched?.ticket_no).toBe('TKT-SUPPLIES-0001');
		expect(fetched?.requisition_type).toBe('supplies');
	});

	it('rejects malformed remote document upon get', async () => {
		// Insert corrupted ticket into store directly
		store.set('requisition_ticket:01JTEST00000000000000000000', {
			_id: 'requisition_ticket:01JTEST00000000000000000000',
			_rev: '1-a',
			type: 'requisition_ticket',
			schema_v: 1,
			shelter_code: 'SH001',
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
			created_by: 'user:staff1',
			ticket_no: 'TKT-FOOD-9999',
			requisition_type: 'invalid_type', // malformed
			status: 'PENDING_PICK',
			source_location: 'warehouse',
			destination_location: 'point',
			requested_by: 'user:staff1',
			items: []
		});

		await expect(repo.get('requisition_ticket:01JTEST00000000000000000000')).rejects.toThrow();
	});

	it('performs legal CAS state transitions with history preservation', async () => {
		const created = await repo.create(
			{
				ticket_no: 'TKT-FOOD-0002',
				requisition_type: 'food',
				meal: 'dinner',
				source_location: 'warehouse:main',
				destination_location: 'distribution_point:c',
				items: [
					{
						item_id: 'item:soup',
						item_name: 'Chicken Soup',
						type_class: 'CONSUMABLE',
						requested_qty: '30',
						allocated_qty: '30'
					}
				]
			},
			ctx
		);

		// PENDING_PICK -> READY_FOR_DISPATCH
		const ready = await repo.transitionTicket(created._id, 'READY_FOR_DISPATCH', ctx);
		expect(ready.status).toBe('READY_FOR_DISPATCH');

		// READY_FOR_DISPATCH -> IN_TRANSIT
		const inTransit = await repo.transitionTicket(ready._id, 'IN_TRANSIT', ctx, {
			driver_name: 'Somchai',
			license_plate: '1กข1234'
		});
		expect(inTransit.status).toBe('IN_TRANSIT');
		expect(inTransit.driver_name).toBe('Somchai');
		expect(inTransit.license_plate).toBe('1กข1234');

		// IN_TRANSIT -> DISTRIBUTING
		const distributing = await repo.transitionTicket(inTransit._id, 'DISTRIBUTING', ctx);
		expect(distributing.status).toBe('DISTRIBUTING');

		// DISTRIBUTING -> SHIFT_CLOSED
		const closed = await repo.transitionTicket(distributing._id, 'SHIFT_CLOSED', ctx);
		expect(closed.status).toBe('SHIFT_CLOSED');

		// SHIFT_CLOSED -> COMPLETED
		const completed = await repo.transitionTicket(closed._id, 'COMPLETED', ctx);
		expect(completed.status).toBe('COMPLETED');
	});

	it('rejects illegal state transitions before persistence', async () => {
		const created = await repo.create(
			{
				ticket_no: 'TKT-FOOD-0003',
				requisition_type: 'food',
				meal: 'breakfast',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:bread',
						item_name: 'Bread',
						type_class: 'CONSUMABLE',
						requested_qty: '10',
						allocated_qty: '10'
					}
				]
			},
			ctx
		);

		// Illegal skip: PENDING_PICK -> DISTRIBUTING
		await expect(repo.transitionTicket(created._id, 'DISTRIBUTING', ctx)).rejects.toThrow(
			/Illegal requisition_ticket transition/
		);
	});

	it('handles CAS conflict reload and recomputes on retry', async () => {
		const created = await repo.create(
			{
				ticket_no: 'TKT-FOOD-0004',
				requisition_type: 'food',
				meal: 'lunch',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:rice',
						item_name: 'Rice',
						type_class: 'CONSUMABLE',
						requested_qty: '10',
						allocated_qty: '10'
					}
				]
			},
			ctx
		);

		let attemptCount = 0;
		const updated = await repo.mutateTicketCAS(
			created._id,
			(current) => {
				attemptCount++;
				if (attemptCount === 1) {
					// Simulate concurrent out-of-band write in CouchDB
					const raw = store.get(created._id)!;
					raw._rev = nextRev(created._id);
					raw.notes = 'concurrent modification';
				}
				return {
					...current,
					notes: `attempt ${attemptCount}`
				};
			},
			ctx
		);

		expect(attemptCount).toBe(2);
		expect(updated.notes).toBe('attempt 2');
	});

	it('fails immediately on non-conflict errors without retrying', async () => {
		const created = await repo.create(
			{
				ticket_no: 'TKT-FOOD-0005',
				requisition_type: 'food',
				meal: 'lunch',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:rice',
						item_name: 'Rice',
						type_class: 'CONSUMABLE',
						requested_qty: '10',
						allocated_qty: '10'
					}
				]
			},
			ctx
		);

		let calls = 0;
		await expect(
			repo.mutateTicketCAS(
				created._id,
				(current) => {
					calls++;
					// Attempt to mutate an immutable field
					return {
						...current,
						ticket_no: 'TKT-FOOD-FORGED'
					};
				},
				ctx
			)
		).rejects.toThrow(/immutable/);

		expect(calls).toBe(1);
	});

	it('rejects decreasing requested_qty post DISTRIBUTING', async () => {
		const created = await repo.create(
			{
				ticket_no: 'TKT-FOOD-0006',
				requisition_type: 'food',
				meal: 'dinner',
				source_location: 'warehouse:main',
				destination_location: 'point:a',
				items: [
					{
						item_id: 'item:rice',
						item_name: 'Rice',
						type_class: 'CONSUMABLE',
						requested_qty: '50',
						allocated_qty: '50'
					}
				]
			},
			ctx
		);

		const ready = await repo.transitionTicket(created._id, 'READY_FOR_DISPATCH', ctx);
		const transit = await repo.transitionTicket(ready._id, 'IN_TRANSIT', ctx);
		const distributing = await repo.transitionTicket(transit._id, 'DISTRIBUTING', ctx);

		await expect(
			repo.mutateTicketCAS(
				distributing._id,
				(current) => ({
					...current,
					items: [
						{
							...current.items[0],
							requested_qty: '20' // decreased from 50
						}
					]
				}),
				ctx
			)
		).rejects.toThrow(/requested_qty cannot be decreased/);
	});
});
