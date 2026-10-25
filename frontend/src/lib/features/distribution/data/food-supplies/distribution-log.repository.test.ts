// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import {
	DistributionLogRemoteRepository,
	type DistributionLogRepository
} from './distribution-log.repository';

const couch = await vi.hoisted(async () => {
	const { createInMemoryCouch } = await import('$lib/testing/in-memory-couch');
	return createInMemoryCouch();
});
const { store, nextRev } = couch;

vi.mock('$lib/db/shelter', () => ({
	SHELTER_CODE: 'SH001',
	SHELTER_DB: 'shelter_sh001',
	getShelterDb: () => 'shelter_sh001'
}));

vi.mock('$lib/db/couch-db', () => couch.couchDbModule);

describe('DistributionLogRemoteRepository', () => {
	const ctx: AuthorContext = {
		createdBy: 'user:field_staff',
		shelterCode: 'SH001',
		roles: ['registration_staff']
	};

	let repo: DistributionLogRepository;
	const dummyTicketId = 'requisition_ticket:01J00000000000000000000000';
	const dummyEvacueeId = 'evacuee:01J00000000000000000000001';
	const dummyVolunteerId = 'volunteer:01J00000000000000000000002';
	const dummyHouseholdId = 'household:01J00000000000000000000003';
	const dummyPoolId = 'bulk_return_pool:01J00000000000000000000004';

	beforeEach(() => {
		couch.reset();
		repo = new DistributionLogRemoteRepository('SH001');
	});

	it('creates Food Log (consumable, non-returnable)', async () => {
		const log = await repo.create(
			{
				ticket_id: dummyTicketId,
				item_id: 'item:cooked_rice',
				qty: '2',
				recipient_type: 'evacuee',
				recipient_id: dummyEvacueeId,
				household_id: dummyHouseholdId,
				meal: 'lunch',
				is_returnable: false,
				is_override: false
			},
			ctx
		);

		expect(log._id).toMatch(/^distribution_log:[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(log.type).toBe('distribution_log');
		expect(log.status).toBe('fulfilled');
		expect(log.is_returnable).toBe(false);
		expect(log.distributed_by).toBe('user:field_staff');

		// Assert no legacy distribution_issue created
		for (const key of store.keys()) {
			expect(key.startsWith('distribution_issue:')).toBe(false);
		}
	});

	it('creates Supplies consumable Log', async () => {
		const log = await repo.create(
			{
				ticket_id: dummyTicketId,
				item_id: 'item:soap',
				qty: '3',
				recipient_type: 'evacuee',
				recipient_id: dummyEvacueeId,
				is_returnable: false,
				is_override: false
			},
			ctx
		);

		expect(log.status).toBe('fulfilled');
		expect(log.is_returnable).toBe(false);
	});

	it('creates Supplies returnable Log (starts as active)', async () => {
		const log = await repo.create(
			{
				ticket_id: dummyTicketId,
				item_id: 'item:wheelchair',
				qty: '1',
				recipient_type: 'evacuee',
				recipient_id: dummyEvacueeId,
				is_returnable: true,
				is_override: false
			},
			ctx
		);

		expect(log.status).toBe('active');
		expect(log.is_returnable).toBe(true);
	});

	it('supports querying and listing logs with filters', async () => {
		await repo.create(
			{
				ticket_id: dummyTicketId,
				item_id: 'item:item_a',
				qty: '1',
				recipient_type: 'outside',
				is_returnable: false,
				is_override: false
			},
			ctx
		);
		await repo.create(
			{
				ticket_id: dummyTicketId,
				item_id: 'item:item_b',
				qty: '1',
				recipient_type: 'volunteer',
				recipient_id: dummyVolunteerId,
				is_returnable: true,
				is_override: false
			},
			ctx
		);

		const all = await repo.list();
		expect(all).toHaveLength(2);

		const returnable = await repo.list({ is_returnable: true });
		expect(returnable).toHaveLength(1);
		expect(returnable[0].item_id).toBe('item:item_b');
	});

	describe('malformed docs', () => {
		const badId = (n: number) => `distribution_log:01J0000000000000000000009${n}`;
		const seedBad = (n: number, fields: Record<string, unknown>) =>
			store.set(badId(n), { _id: badId(n), type: 'distribution_log', ...fields });
		const seedGood = () =>
			repo.create(
				{
					ticket_id: dummyTicketId,
					item_id: 'item:a',
					qty: '1',
					recipient_type: 'evacuee',
					recipient_id: dummyEvacueeId,
					is_returnable: true,
					is_override: false
				},
				ctx
			);

		it('list skips a malformed doc instead of throwing', async () => {
			const good = await seedGood();
			seedBad(1, { ticket_id: dummyTicketId, item_id: 'item:a' });
			expect((await repo.list()).map((l) => l._id)).toEqual([good._id]);
		});

		it('listWithSkipped reports only malformed docs that match the filter on raw fields', async () => {
			const good = await seedGood();
			const otherTicket = 'requisition_ticket:01J00000000000000000000099';
			seedBad(1, { ticket_id: dummyTicketId, item_id: 'item:a', is_returnable: true });
			seedBad(2, { ticket_id: otherTicket, item_id: 'item:a', is_returnable: true });

			const mine = await repo.listWithSkipped({ ticket_id: dummyTicketId });
			expect(mine.items.map((l) => l._id)).toEqual([good._id]);
			expect(mine.skipped.map((s) => s._id)).toEqual([badId(1)]);

			const other = await repo.listWithSkipped({ ticket_id: otherTicket });
			expect(other.items).toEqual([]);
			expect(other.skipped.map((s) => s._id)).toEqual([badId(2)]);

			const wrongItem = await repo.listWithSkipped({ item_id: 'item:zzz' });
			expect(wrongItem.skipped).toEqual([]);
		});

		it('matches on is_returnable, status and recipient_id raw fields', async () => {
			seedBad(1, { is_returnable: false, status: 'fulfilled', recipient_id: null });
			const byReturnable = await repo.listWithSkipped({ is_returnable: true });
			expect(byReturnable.skipped).toEqual([]);
			const byStatus = await repo.listWithSkipped({ status: 'active' });
			expect(byStatus.skipped).toEqual([]);
			const byRecipient = await repo.listWithSkipped({ recipient_id: dummyEvacueeId });
			expect(byRecipient.skipped).toEqual([]);
			const matching = await repo.listWithSkipped({
				is_returnable: false,
				status: 'fulfilled',
				recipient_id: null
			});
			expect(matching.skipped.map((s) => s._id)).toEqual([badId(1)]);
		});

		it('counts an unreadable filtered field as matching', async () => {
			seedBad(1, { ticket_id: 42, item_id: undefined, is_returnable: 'yes', recipient_id: 7 });
			const found = await repo.listWithSkipped({
				ticket_id: dummyTicketId,
				item_id: 'item:a',
				is_returnable: true,
				recipient_id: dummyEvacueeId
			});
			expect(found.skipped.map((s) => s._id)).toEqual([badId(1)]);
		});

		it('returns every malformed doc when no filter is given', async () => {
			seedBad(1, {});
			seedBad(2, { ticket_id: dummyTicketId });
			expect((await repo.listWithSkipped()).skipped).toHaveLength(2);
		});
	});

	it('records full return on returnable log', async () => {
		const created = await repo.create(
			{
				ticket_id: dummyTicketId,
				item_id: 'item:wheelchair',
				qty: '1',
				recipient_type: 'evacuee',
				recipient_id: dummyEvacueeId,
				is_returnable: true,
				is_override: false
			},
			ctx
		);

		const returned = await repo.recordReturn(
			created._id,
			{
				qty_returned: '1',
				condition_on_return: 'READY',
				clear_reason: 'routine'
			},
			ctx
		);

		expect(returned.status).toBe('returned');
		expect(returned.qty_returned).toBe('1');
		expect(returned.returned_by).toBe('user:field_staff');
		expect(returned.condition_on_return).toBe('READY');
	});

	it('records bulk dropoff return linked to bulk_pool_id', async () => {
		const created = await repo.create(
			{
				ticket_id: dummyTicketId,
				item_id: 'item:cot',
				qty: '1',
				recipient_type: 'evacuee',
				recipient_id: dummyEvacueeId,
				is_returnable: true,
				is_override: false
			},
			ctx
		);

		const returned = await repo.recordReturn(
			created._id,
			{
				qty_returned: '1',
				clear_reason: 'bulk_dropoff',
				bulk_pool_id: dummyPoolId
			},
			ctx
		);

		expect(returned.status).toBe('returned');
		expect(returned.clear_reason).toBe('bulk_dropoff');
		expect(returned.bulk_pool_id).toBe(dummyPoolId);
	});

	it('records partial return on returnable log', async () => {
		const created = await repo.create(
			{
				ticket_id: dummyTicketId,
				item_id: 'item:mat',
				qty: '5',
				recipient_type: 'evacuee',
				recipient_id: dummyEvacueeId,
				is_returnable: true,
				is_override: false
			},
			ctx
		);

		const returned = await repo.recordReturn(
			created._id,
			{
				qty_returned: '2',
				clear_reason: 'routine',
				condition_on_return: 'READY'
			},
			ctx
		);

		expect(returned.status).toBe('partially_returned');
		expect(returned.qty_returned).toBe('2');
		expect(returned.returned_by).toBe('user:field_staff');
	});

	it('rejects zero or negative returned quantity on physical return', async () => {
		const created = await repo.create(
			{
				ticket_id: dummyTicketId,
				item_id: 'item:mat',
				qty: '3',
				recipient_type: 'evacuee',
				recipient_id: dummyEvacueeId,
				is_returnable: true,
				is_override: false
			},
			ctx
		);

		await expect(
			repo.recordReturn(
				created._id,
				{
					qty_returned: '0',
					clear_reason: 'routine'
				},
				ctx
			)
		).rejects.toThrow(/positive/);
	});

	it('rejects returned quantity greater than issued quantity on physical return', async () => {
		const created = await repo.create(
			{
				ticket_id: dummyTicketId,
				item_id: 'item:mat',
				qty: '3',
				recipient_type: 'evacuee',
				recipient_id: dummyEvacueeId,
				is_returnable: true,
				is_override: false
			},
			ctx
		);

		await expect(
			repo.recordReturn(
				created._id,
				{
					qty_returned: '5',
					clear_reason: 'routine'
				},
				ctx
			)
		).rejects.toThrow(/cannot exceed/);
	});

	it('rejects bulk_dropoff physical return without bulk_pool_id', async () => {
		const created = await repo.create(
			{
				ticket_id: dummyTicketId,
				item_id: 'item:mat',
				qty: '3',
				recipient_type: 'evacuee',
				recipient_id: dummyEvacueeId,
				is_returnable: true,
				is_override: false
			},
			ctx
		);

		await expect(
			repo.recordReturn(
				created._id,
				{
					qty_returned: '3',
					clear_reason: 'bulk_dropoff'
				},
				ctx
			)
		).rejects.toThrow(/bulk_dropoff requires bulk_pool_id/);
	});

	it('records lost clear without physical return quantity and requires notes', async () => {
		const created = await repo.create(
			{
				ticket_id: dummyTicketId,
				item_id: 'item:blanket',
				qty: '1',
				recipient_type: 'evacuee',
				recipient_id: dummyEvacueeId,
				is_returnable: true,
				is_override: false
			},
			ctx
		);

		const cleared = await repo.recordClear(
			created._id,
			{
				clear_reason: 'lost',
				notes: 'Lost in flash flood evacuation'
			},
			ctx
		);

		expect(cleared.status).toBe('lost');
		expect(cleared.clear_reason).toBe('lost');
		expect(cleared.notes).toBe('Lost in flash flood evacuation');
		expect(cleared.returned_by).toBe('user:field_staff');
		expect(cleared.returned_at).toBeDefined();
		// Assert qty_returned is NOT fabricated as full issued qty
		expect(cleared.qty_returned).toBeUndefined();
	});

	it('records waived clear without physical return quantity and requires notes', async () => {
		const created = await repo.create(
			{
				ticket_id: dummyTicketId,
				item_id: 'item:crutches',
				qty: '1',
				recipient_type: 'evacuee',
				recipient_id: dummyEvacueeId,
				is_returnable: true,
				is_override: false
			},
			ctx
		);

		const cleared = await repo.recordClear(
			created._id,
			{
				clear_reason: 'waived',
				notes: 'Granted permanently to bedridden evacuee'
			},
			ctx
		);

		expect(cleared.status).toBe('waived');
		expect(cleared.clear_reason).toBe('waived');
		expect(cleared.notes).toBe('Granted permanently to bedridden evacuee');
		expect(cleared.returned_by).toBe('user:field_staff');
		expect(cleared.returned_at).toBeDefined();
		expect(cleared.qty_returned).toBeUndefined();
	});

	it('rejects recordClear without notes', async () => {
		const created = await repo.create(
			{
				ticket_id: dummyTicketId,
				item_id: 'item:blanket',
				qty: '1',
				recipient_type: 'evacuee',
				recipient_id: dummyEvacueeId,
				is_returnable: true,
				is_override: false
			},
			ctx
		);

		await expect(
			repo.recordClear(
				created._id,
				{
					clear_reason: 'lost',
					notes: '   '
				},
				ctx
			)
		).rejects.toThrow(/notes are required/);
	});

	it('handles CAS conflict reload and recomputes correctly on recordClear', async () => {
		const created = await repo.create(
			{
				ticket_id: dummyTicketId,
				item_id: 'item:blanket',
				qty: '1',
				recipient_type: 'evacuee',
				recipient_id: dummyEvacueeId,
				is_returnable: true,
				is_override: false
			},
			ctx
		);

		// Simulate concurrent touch before clear
		const raw = store.get(created._id)!;
		raw._rev = nextRev(created._id);

		const cleared = await repo.recordClear(
			created._id,
			{
				clear_reason: 'lost',
				notes: 'Resolved after conflict retry'
			},
			ctx
		);

		expect(cleared.status).toBe('lost');
		expect(cleared.clear_reason).toBe('lost');
		expect(cleared.notes).toBe('Resolved after conflict retry');
	});

	it('records void audit fields on voiding', async () => {
		const created = await repo.create(
			{
				ticket_id: dummyTicketId,
				item_id: 'item:blanket',
				qty: '2',
				recipient_type: 'evacuee',
				recipient_id: dummyEvacueeId,
				is_returnable: false,
				is_override: false
			},
			ctx
		);

		const voided = await repo.recordVoid(created._id, ctx, 'Entered wrong quantity');
		expect(voided.status).toBe('voided');
		expect(voided.voided_by).toBe('user:field_staff');
		expect(voided.voided_at).toBeDefined();
	});

	it('rejects voiding a loan after a physical return has begun', async () => {
		const created = await repo.create(
			{
				ticket_id: dummyTicketId,
				item_id: 'item:wheelchair',
				qty: '2',
				recipient_type: 'evacuee',
				recipient_id: dummyEvacueeId,
				is_returnable: true,
				is_override: false
			},
			ctx
		);
		const partiallyReturned = await repo.recordReturn(
			created._id,
			{ qty_returned: '1', clear_reason: 'routine' },
			ctx
		);
		expect(partiallyReturned.status).toBe('partially_returned');

		await expect(repo.recordVoid(created._id, ctx, 'Too late')).rejects.toThrow(
			/partially_returned/
		);
	});

	it('does not write when the mutator returns the current doc', async () => {
		const created = await repo.create(
			{
				ticket_id: dummyTicketId,
				item_id: 'item:blanket',
				qty: '2',
				recipient_type: 'evacuee',
				recipient_id: dummyEvacueeId,
				is_returnable: true,
				is_override: false
			},
			ctx
		);

		const same = await repo.mutateLogCAS(created._id, (current) => current);

		expect(same._rev).toBe(created._rev);
		expect(store.get(created._id)?._rev).toBe(created._rev);
	});

	it('rejects mutating immutable issuance fields', async () => {
		const created = await repo.create(
			{
				ticket_id: dummyTicketId,
				item_id: 'item:blanket',
				qty: '2',
				recipient_type: 'evacuee',
				recipient_id: dummyEvacueeId,
				is_returnable: false,
				is_override: false
			},
			ctx
		);

		await expect(
			repo.mutateLogCAS(created._id, (current) => ({
				...current,
				qty: '5' // attempted issuance quantity mutation
			}))
		).rejects.toThrow(/immutable after issuance/);
	});
});
