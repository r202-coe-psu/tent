import { describe, expect, it, vi } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import {
	createDistributeEntry,
	type DistributeInput,
	type StockLotBalance
} from '../domain/operations';
import { planLotSplit } from '../domain/lot-split';
import { distributeAcrossLots, type LotDistributor } from './distribute-across-lots';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'tester' };
const REF = 'requisition_ticket:direct-01JTEST';
const NOW = Date.parse('2026-10-02T00:00:00.000Z');

function lot(lotRef: string, qty: string): StockLotBalance {
	return {
		lot_ref: lotRef,
		item_id: 'item:x',
		unit: 'ชิ้น',
		qty,
		received_at: '2026-09-01T00:00:00.000Z'
	};
}

const lots = [
	lot('stock_ledger:L1', '6'),
	lot('stock_ledger:L2', '20'),
	lot('stock_ledger:L3', '16')
];

function fakeRepo(failOn?: string): LotDistributor & { calls: DistributeInput[] } {
	const calls: DistributeInput[] = [];
	return {
		calls,
		distributeStock: vi.fn(async (input: DistributeInput) => {
			calls.push(input);
			if (input.lot_ref === failOn) throw new Error('Insufficient stock in lot');
			return createDistributeEntry(input, ctx);
		})
	};
}

describe('distributeAcrossLots (CR-143 FR-A8, FR-A9)', () => {
	it('AC-A5: writes 6 / 20 / 4 in plan order, every row on the same ref_id', async () => {
		const repo = fakeRepo();
		const plan = planLotSplit(lots, '30', NOW);

		const result = await distributeAcrossLots(
			repo,
			{ allocations: plan.allocations, item_id: 'item:x', ref_id: REF, note: 'ครัวกลาง' },
			ctx
		);

		expect(repo.calls.map((c) => [c.lot_ref, c.qty])).toEqual([
			['stock_ledger:L1', '6'],
			['stock_ledger:L2', '20'],
			['stock_ledger:L3', '4']
		]);
		expect(new Set(repo.calls.map((c) => c.ref_id))).toEqual(new Set([REF]));
		expect(repo.calls.every((c) => c.unit === 'ชิ้น' && c.note === 'ครัวกลาง')).toBe(true);
		expect(result).toMatchObject({
			complete: true,
			distributedQty: '30',
			remainingQty: '0',
			ref_id: REF
		});
		expect(result.distributed).toHaveLength(3);
		expect(result.failure).toBeUndefined();
	});

	it('FR-A9: stops at the first failing row, keeps the earlier ones, reports what is left', async () => {
		const repo = fakeRepo('stock_ledger:L2');
		const plan = planLotSplit(lots, '30', NOW);

		const result = await distributeAcrossLots(
			repo,
			{ note: 'ครัวกลาง', allocations: plan.allocations, item_id: 'item:x', ref_id: REF },
			ctx
		);

		expect(repo.calls.map((c) => c.lot_ref)).toEqual(['stock_ledger:L1', 'stock_ledger:L2']);
		expect(result.complete).toBe(false);
		expect(result.distributed.map((d) => [d.lot_ref, d.qty])).toEqual([['stock_ledger:L1', '6']]);
		expect(result.distributedQty).toBe('6');
		expect(result.remainingQty).toBe('24');
		expect(result.failure).toEqual({
			lot_ref: 'stock_ledger:L2',
			qty: '20',
			message: 'Insufficient stock in lot'
		});
	});

	it('reports a first-row failure as nothing cut, everything remaining', async () => {
		const repo = fakeRepo('stock_ledger:L1');
		const plan = planLotSplit(lots, '10', NOW);

		const result = await distributeAcrossLots(
			repo,
			{ note: 'ครัวกลาง', allocations: plan.allocations, item_id: 'item:x', ref_id: REF },
			ctx
		);

		expect(result.distributed).toEqual([]);
		expect(result.distributedQty).toBe('0');
		expect(result.remainingQty).toBe('10');
	});

	it('an empty plan is trivially complete and writes nothing', async () => {
		const repo = fakeRepo();
		const result = await distributeAcrossLots(
			repo,
			{ note: 'ครัวกลาง', allocations: [], item_id: 'item:x', ref_id: REF },
			ctx
		);
		expect(repo.calls).toEqual([]);
		expect(result.complete).toBe(true);
	});
});
