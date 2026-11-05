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

import {
	addLine,
	buildAddEntriesInput,
	linesFromOutstandingLoans,
	type AddEntryLine,
	type OutstandingLoanRow
} from '../../ui/model/bulk-return-add-entry';
import {
	addBulkReturnEntries,
	findWrittenBulkReturnEntries
} from './bulk-return-pool-v3-add-entry';
import {
	createBulkReturnPoolV3Fixture,
	dist,
	EVACUEE,
	loanId,
	racingPoolRepo,
	type BulkReturnPoolV3Fixture as Fx
} from './bulk-return-pool-v3.test-support';

describe('bulk return pool v3 — "return all" re-fill after a failed save', () => {
	let poolRepo: Fx['poolRepo'];
	let logRepo: Fx['logRepo'];
	let deps: Fx['deps'];
	let nextOp: Fx['nextOp'];
	let openPool: Fx['openPool'];
	let seedLoan: Fx['seedLoan'];
	let entryDocCount: Fx['entryDocCount'];

	beforeEach(() => {
		({ poolRepo, logRepo, deps, nextOp, openPool, seedLoan, entryDocCount } =
			createBulkReturnPoolV3Fixture(couch));
	});

	const rows: OutstandingLoanRow[] = [
		{
			logId: loanId(80),
			item_id: 'item:cot',
			itemName: 'cot',
			unit: 'piece',
			outstanding: '3',
			distributed_at: '2026-01-01T00:00:00.000Z'
		}
	];

	function returnAll(current: readonly AddEntryLine[]) {
		return linesFromOutstandingLoans(
			rows,
			new Set(['item:cot']),
			(preset) => addLine([], nextOp, preset)[0],
			current
		).lines;
	}

	/** First save: the entry is written, then the fence read fails like a dropped connection. */
	async function failedFirstSave(poolId: string, lines: AddEntryLine[]) {
		const flaky = {
			...deps,
			poolRepo: racingPoolRepo(poolRepo, async () => {
				const written = [...couch.store.keys()].some((k) => k.startsWith('bulk_return_entry:'));
				if (written) throw new Error('Failed to fetch');
			})
		};
		const input = buildAddEntriesInput({
			poolId,
			returner: { type: 'evacuee', id: EVACUEE },
			lines
		});
		await expect(addBulkReturnEntries(input!, dist, flaky)).rejects.toThrow('Failed to fetch');
	}

	it('keeps the operationUlids on re-fill, so the retry replays instead of double counting', async () => {
		const pool = await openPool('Gate A');
		await seedLoan(80, { qty: '3' });

		const lines = returnAll([]);
		await failedFirstSave(pool._id, lines);
		expect(entryDocCount()).toBe(1);
		expect((await logRepo.get(loanId(80)))?.applied_bulk_entry_ids ?? []).toEqual([]);

		// the form kept the lines; staff tap "return all" again
		const refilled = returnAll(lines);
		expect(refilled.map((l) => l.operationUlid)).toEqual(lines.map((l) => l.operationUlid));

		const retry = await addBulkReturnEntries(
			buildAddEntriesInput({
				poolId: pool._id,
				returner: { type: 'evacuee', id: EVACUEE },
				lines: refilled
			})!,
			dist,
			deps
		);

		expect(entryDocCount()).toBe(1);
		expect(retry.results).toHaveLength(1);
		expect(retry.results[0].replayed).toBe(true);
		expect(retry.results[0].loansApplied).toEqual([loanId(80)]);
		const loan = await logRepo.get(loanId(80));
		expect(loan?.qty_returned).toBe('3');
		expect(loan?.applied_bulk_entry_ids).toEqual([retry.results[0].entry._id]);
	});

	it('keeps the written qty when the outstanding total changed: retry replays, loans counted once', async () => {
		const pool = await openPool('Gate A');
		await seedLoan(80, { qty: '3' });

		// staff typed 2 for the cot; the first save wrote that entry, then failed mid-batch
		const lines = addLine([], nextOp, { item_id: 'item:cot', qty: '2' });
		await failedFirstSave(pool._id, lines);
		expect(entryDocCount()).toBe(1);

		// "return all" now yields 3 (the outstanding loan); the lookup finds line X already written
		const written = await findWrittenBulkReturnEntries(
			lines.map((l) => l.operationUlid),
			dist,
			deps
		);
		expect(written.get(lines[0].operationUlid)).toMatchObject({ qty: '2', item_id: 'item:cot' });
		const refilled = linesFromOutstandingLoans(
			rows,
			new Set(['item:cot']),
			(preset) => addLine([], nextOp, preset)[0],
			lines,
			written
		);
		expect(refilled.keptAtWrittenQtyItemIds).toEqual(['item:cot']);
		expect(refilled.lines).toEqual(lines);

		// saving again replays the written entry (no ConcurrencyCollisionError, no second entry)
		const retry = await addBulkReturnEntries(
			buildAddEntriesInput({
				poolId: pool._id,
				returner: { type: 'evacuee', id: EVACUEE },
				lines: refilled.lines
			})!,
			dist,
			deps
		);

		expect(entryDocCount()).toBe(1);
		expect(retry.results).toHaveLength(1);
		expect(retry.results[0].replayed).toBe(true);
		expect(retry.results[0].loansApplied).toEqual([loanId(80)]);
		const loan = await logRepo.get(loanId(80));
		expect(loan?.qty_returned).toBe('2');
		expect(loan?.applied_bulk_entry_ids).toEqual([retry.results[0].entry._id]);
	});

	it('mints a new ulid for a changed qty when no entry was written', () => {
		const lines = addLine([], nextOp, { item_id: 'item:cot', qty: '2' });
		const refilled = linesFromOutstandingLoans(
			rows,
			new Set(['item:cot']),
			(preset) => addLine([], nextOp, preset)[0],
			lines,
			new Map()
		);
		expect(refilled.lines[0].qty).toBe('3');
		expect(refilled.lines[0].operationUlid).not.toBe(lines[0].operationUlid);
		expect(refilled.keptAtWrittenQtyItemIds).toEqual([]);
	});

	it('without currentLines the re-fill mints new ulids (what would write a second entry)', async () => {
		const lines = returnAll([]);
		const naive = linesFromOutstandingLoans(
			rows,
			new Set(['item:cot']),
			(preset) => addLine([], nextOp, preset)[0]
		).lines;

		expect(naive[0].operationUlid).not.toBe(lines[0].operationUlid);
	});
});
