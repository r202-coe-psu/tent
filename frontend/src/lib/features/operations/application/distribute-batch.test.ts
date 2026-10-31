import { describe, expect, it, vi } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import { createDistributeEntry, type DistributeInput } from '../domain/operations';
import type { BatchLinePlan } from '../domain/distribute-batch';
import { distributeBatch } from './distribute-batch';
import type { LotDistributor } from './distribute-across-lots';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'tester' };
const REF = 'requisition_ticket:direct-01JBATCH';

function plan(key: string, itemId: string, rows: [string, string][], unit = 'ชิ้น'): BatchLinePlan {
	return {
		key,
		item_id: itemId,
		allocations: rows.map(([lot_ref, qty]) => ({
			lot_ref,
			qty,
			lot: { lot_ref, item_id: itemId, unit, qty, received_at: '2026-09-01T00:00:00.000Z' }
		}))
	};
}

function fakeRepo(failOn: readonly string[] = []): LotDistributor & { calls: DistributeInput[] } {
	const calls: DistributeInput[] = [];
	return {
		calls,
		distributeStock: vi.fn(async (input: DistributeInput) => {
			calls.push(input);
			if (failOn.includes(input.lot_ref)) throw new Error('Insufficient stock in lot');
			return createDistributeEntry(input, ctx);
		})
	};
}

const rice = plan('a', 'item:rice', [
	['stock_ledger:R1', '6'],
	['stock_ledger:R2', '4']
]);
const water = plan('b', 'item:water', [['stock_ledger:W1', '24']], 'ขวด');
const salt = plan('c', 'item:salt', [['stock_ledger:S1', '2']]);

describe('distributeBatch (#837, FR-A8, FR-A9)', () => {
	it('writes the lines in display order, every row on the one ref_id and destination', async () => {
		const repo = fakeRepo();

		const result = await distributeBatch(repo, [rice, water, salt], REF, 'ครัวกลาง', ctx);

		expect(repo.calls.map((c) => [c.item_id, c.lot_ref, c.qty, c.unit])).toEqual([
			['item:rice', 'stock_ledger:R1', '6', 'ชิ้น'],
			['item:rice', 'stock_ledger:R2', '4', 'ชิ้น'],
			['item:water', 'stock_ledger:W1', '24', 'ขวด'],
			['item:salt', 'stock_ledger:S1', '2', 'ชิ้น']
		]);
		expect(new Set(repo.calls.map((c) => c.ref_id))).toEqual(new Set([REF]));
		expect(repo.calls.every((c) => c.note === 'ครัวกลาง')).toBe(true);
		expect(result).toEqual({
			ref_id: REF,
			complete: true,
			outcomes: [
				{ kind: 'done', key: 'a', distributedQty: '10' },
				{ kind: 'done', key: 'b', distributedQty: '24' },
				{ kind: 'done', key: 'c', distributedQty: '2' }
			]
		});
	});

	it('a failure on the first row of a line cuts nothing of it and skips the later lines', async () => {
		const repo = fakeRepo(['stock_ledger:W1']);

		const result = await distributeBatch(repo, [rice, water, salt], REF, 'ครัวกลาง', ctx);

		expect(repo.calls.map((c) => c.lot_ref)).toEqual([
			'stock_ledger:R1',
			'stock_ledger:R2',
			'stock_ledger:W1'
		]);
		expect(result.complete).toBe(false);
		expect(result.outcomes).toEqual([
			{ kind: 'done', key: 'a', distributedQty: '10' },
			{ kind: 'failed', key: 'b', message: 'Insufficient stock in lot' },
			{ kind: 'not_attempted', key: 'c' }
		]);
	});

	it('a failure on a later row of a line reports what landed and what is left, in the base unit', async () => {
		const repo = fakeRepo(['stock_ledger:R2']);

		const result = await distributeBatch(repo, [rice, water], REF, 'ครัวกลาง', ctx);

		expect(result.outcomes).toEqual([
			{
				kind: 'partial',
				key: 'a',
				distributedQty: '6',
				remainingQty: '4',
				unit: 'ชิ้น',
				message: 'Insufficient stock in lot'
			},
			{ kind: 'not_attempted', key: 'b' }
		]);
		expect(repo.calls.map((c) => c.lot_ref)).toEqual(['stock_ledger:R1', 'stock_ledger:R2']);
	});

	it('retrying only the unlocked lines never writes a landed row again', async () => {
		const first = fakeRepo(['stock_ledger:W1']);
		await distributeBatch(first, [rice, water, salt], REF, 'ครัวกลาง', ctx);

		const retry = fakeRepo();
		const result = await distributeBatch(retry, [water, salt], REF, 'ครัวกลาง', ctx);

		expect(retry.calls.map((c) => c.lot_ref)).toEqual(['stock_ledger:W1', 'stock_ledger:S1']);
		expect(retry.calls.every((c) => c.ref_id === REF)).toBe(true);
		expect(result.complete).toBe(true);
	});

	it('an empty batch writes nothing and is trivially complete', async () => {
		const repo = fakeRepo();
		const result = await distributeBatch(repo, [], REF, 'ครัวกลาง', ctx);
		expect(repo.calls).toEqual([]);
		expect(result).toEqual({ ref_id: REF, outcomes: [], complete: true });
	});
});
