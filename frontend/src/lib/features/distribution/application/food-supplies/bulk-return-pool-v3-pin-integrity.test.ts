// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';

const couch = await vi.hoisted(async () => {
	const { createInMemoryCouch } = await import('$lib/testing/in-memory-couch');
	return createInMemoryCouch();
});

vi.mock('$lib/db/shelter', () => ({
	SHELTER_CODE: 'SH001',
	SHELTER_DB: 'shelter_sh001',
	getShelterDb: () => 'shelter_sh001'
}));

vi.mock('$lib/db/couch-db', () => couch.couchDbModule);

vi.mock('$lib/features/catalog', () => ({
	catalogRepository: () => ({
		listItemMasters: async () => [],
		listUnitsOfMeasure: async () => []
	}),
	itemMasterUnit: (item: { base_unit?: string; unit?: string }) =>
		item.base_unit ?? item.unit ?? 'piece',
	canonicalizeUnitCode: (value: unknown) => value
}));

import { BulkReturnPoolStateError, DistributionDataIntegrityError } from './errors';
import { cancelBulkReturnPool, submitBulkReturnPool } from './bulk-return-pool-v3-lifecycle';
import { addBulkReturnEntries } from './bulk-return-pool-v3-add-entry';
import { moveBulkReturnEntry } from './bulk-return-pool-v3-move';
import { voidBulkReturnEntry } from './bulk-return-pool-v3-void';
import {
	getBulkReturnPoolOverview,
	listBulkReturnPoolClosedLoanRefs
} from './bulk-return-pool-v3-read';
import {
	createBulkReturnPoolV3Fixture,
	dist,
	EVACUEE,
	loanId,
	mgr,
	type BulkReturnPoolV3Fixture as Fx
} from './bulk-return-pool-v3.test-support';

describe('bulk return pool v3 — unreadable referenced pool fails writes closed (CR-193 §19)', () => {
	let poolRepo: Fx['poolRepo'];
	let eventRepo: Fx['eventRepo'];
	let logRepo: Fx['logRepo'];
	let deps: Fx['deps'];
	let nextOp: Fx['nextOp'];
	let openPool: Fx['openPool'];
	let seedLoan: Fx['seedLoan'];

	beforeEach(() => {
		({ poolRepo, eventRepo, logRepo, deps, nextOp, openPool, seedLoan } =
			createBulkReturnPoolV3Fixture(couch));
	});

	/** Entry created in A (loan applied) then moved to B; returns the ids. A is then unreadable. */
	async function setup() {
		const a = await openPool('Gate A');
		const b = await openPool('Gate B');
		const c = await openPool('Gate C');
		await seedLoan(80, { qty: '3' });
		const res = await addBulkReturnEntries(
			{
				pool_id: a._id,
				returner: { type: 'evacuee', id: EVACUEE },
				items: [{ item_id: 'item:cot', qty: '2', operationUlid: nextOp() }]
			},
			dist,
			deps
		);
		const entry = res.results[0].entry;
		await moveBulkReturnEntry({ entry_id: entry._id, to_pool_id: b._id }, mgr, deps);
		return { a, b, c, entry };
	}

	const removePool = (id: string) => couch.store.delete(id);
	const legacyPool = (id: string) =>
		couch.store.set(id, {
			_id: id,
			_rev: '1-legacy',
			type: 'bulk_return_pool',
			schema_v: 2,
			name: 'Legacy'
		} as never);

	async function expectNothingWritten(entryId: string) {
		const events = await eventRepo.listAll();
		expect(events.voids).toHaveLength(0);
		expect(events.moves).toHaveLength(1); // only the setup move
		const loan = await logRepo.get(loanId(80));
		expect(loan?.status).toBe('partially_returned');
		expect(loan?.applied_bulk_entry_ids).toEqual([entryId]);
	}

	const breakers: [string, (id: string) => unknown][] = [
		['missing pool doc', removePool],
		['legacy v2 pool doc', legacyPool]
	];

	describe.each(breakers)('%s', (_name, breakPool) => {
		it('rejects void and writes nothing', async () => {
			const { a, entry } = await setup();
			breakPool(a._id);

			const err = await voidBulkReturnEntry({ entry_id: entry._id }, mgr, deps).catch((e) => e);

			expect(err).toBeInstanceOf(DistributionDataIntegrityError);
			expect((err as DistributionDataIntegrityError).docIds).toEqual([a._id]);
			await expectNothingWritten(entry._id);
		});

		it('rejects move and writes nothing', async () => {
			const { a, c, entry } = await setup();
			breakPool(a._id);

			await expect(
				moveBulkReturnEntry({ entry_id: entry._id, to_pool_id: c._id }, mgr, deps)
			).rejects.toBeInstanceOf(DistributionDataIntegrityError);
			await expectNothingWritten(entry._id);
		});

		it('rejects cancel and releases the cancel lock', async () => {
			const { a, b } = await setup();
			breakPool(a._id);

			await expect(cancelBulkReturnPool(b._id, nextOp(), mgr, deps)).rejects.toBeInstanceOf(
				DistributionDataIntegrityError
			);
			const pool = await poolRepo.get(b._id);
			expect(pool?.status).toBe('OPEN');
			expect(pool?.lock ?? null).toBeNull();
		});

		it('rejects submit and releases the submit lock', async () => {
			const { a, b } = await setup();
			breakPool(a._id);

			await expect(submitBulkReturnPool(b._id, nextOp(), mgr, deps)).rejects.toBeInstanceOf(
				DistributionDataIntegrityError
			);
			const pool = await poolRepo.get(b._id);
			expect(pool?.status).toBe('OPEN');
			expect(pool?.lock ?? null).toBeNull();
		});

		it('keeps the read paths lenient', async () => {
			const { a, b } = await setup();
			breakPool(a._id);

			await expect(listBulkReturnPoolClosedLoanRefs(b._id, mgr, deps)).resolves.toBeDefined();
			await expect(getBulkReturnPoolOverview({}, mgr, deps)).resolves.toBeDefined();
		});
	});

	it('reports source_closed when a non-late entry leaves a SUBMITTED source', async () => {
		const a = await openPool('Gate A');
		const b = await openPool('Gate B');
		await seedLoan(80, { qty: '3' });
		const res = await addBulkReturnEntries(
			{
				pool_id: a._id,
				returner: { type: 'evacuee', id: EVACUEE },
				items: [{ item_id: 'item:cot', qty: '2', operationUlid: nextOp() }]
			},
			dist,
			deps
		);
		const entry = res.results[0].entry;
		await submitBulkReturnPool(a._id, nextOp(), mgr, deps);

		const err = await moveBulkReturnEntry(
			{ entry_id: entry._id, to_pool_id: b._id },
			mgr,
			deps
		).catch((e) => e);

		expect(err).toBeInstanceOf(BulkReturnPoolStateError);
		expect((err as BulkReturnPoolStateError).reason).toBe('source_closed');
	});
});
