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

import { submitBulkReturnPool } from './bulk-return-pool-v3-lifecycle';
import { moveBulkReturnEntry } from './bulk-return-pool-v3-move';
import { voidBulkReturnEntry } from './bulk-return-pool-v3-void';
import { getBulkReturnPoolTimeline } from './bulk-return-pool-v3-read';
import { createBulkReturnEntryVoid } from '../../domain/food-supplies';
import { BulkReturnPoolStateError } from './errors';
import {
	createBulkReturnPoolV3Fixture,
	mgr,
	type BulkReturnPoolV3Fixture as Fx
} from './bulk-return-pool-v3.test-support';

describe('getBulkReturnPoolTimeline', () => {
	let deps: Fx['deps'];
	let nextOp: Fx['nextOp'];
	let openPool: Fx['openPool'];
	let add: Fx['add'];

	beforeEach(() => {
		({ deps, nextOp, openPool, add } = createBulkReturnPoolV3Fixture(couch));
	});

	it('lists open, add, move out, void and submit for the source pool and move in for the target', async () => {
		const a = await openPool('Gate A');
		const b = await openPool('Gate B');
		const first = await add(a._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '2' }]);
		const second = await add(a._id, { type: 'unspecified' }, [
			{ item_id: 'item:wheelchair', qty: '1' }
		]);
		await add(a._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '1' }]);
		const movedId = first.results[0].entry._id;
		await moveBulkReturnEntry({ entry_id: movedId, to_pool_id: b._id }, mgr, deps);
		await voidBulkReturnEntry({ entry_id: second.results[0].entry._id }, mgr, deps);
		await submitBulkReturnPool(a._id, nextOp(), mgr, deps);

		const timelineA = await getBulkReturnPoolTimeline(a._id, mgr, deps);
		expect(timelineA.skipped).toEqual([]);
		expect(timelineA.events.map((e) => e.kind)).toEqual([
			'opened',
			'entry_added',
			'entry_added',
			'entry_added',
			'moved_out',
			'voided',
			'submitted'
		]);
		expect(timelineA.events.find((e) => e.kind === 'moved_out')).toMatchObject({
			entry_id: movedId,
			other_pool_id: b._id
		});

		const timelineB = await getBulkReturnPoolTimeline(b._id, mgr, deps);
		expect(timelineB.events.map((e) => e.kind)).toEqual(['opened', 'moved_in']);
		expect(timelineB.events[1]).toMatchObject({ entry_id: movedId, other_pool_id: a._id });
	});

	it('flags a void written after the pool was submitted as no_effect', async () => {
		const a = await openPool('Gate A');
		const added = await add(a._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '2' }]);
		const entry = added.results[0].entry;
		await submitBulkReturnPool(a._id, nextOp(), mgr, deps);
		await deps.eventRepo!.createVoid(createBulkReturnEntryVoid({ entry, pool_id: a._id }, mgr));

		const { events } = await getBulkReturnPoolTimeline(a._id, mgr, deps);
		const voided = events.find((e) => e.kind === 'voided');
		expect(voided).toMatchObject({ entry_id: entry._id, no_effect: true });
		expect(events.find((e) => e.kind === 'entry_added')?.no_effect).toBeUndefined();
	});

	it('rejects an unknown pool', async () => {
		await expect(
			getBulkReturnPoolTimeline('bulk_return_pool:01J00000000000000000000000', mgr, deps)
		).rejects.toBeInstanceOf(BulkReturnPoolStateError);
	});
});
