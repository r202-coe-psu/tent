import { describe, expect, it } from 'vitest';
import { planLotSplit } from './lot-split';
import { rankLotsForIssue } from './lot-priority';
import type { StockLotBalance } from './operations';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-02T00:00:00.000Z');
const at = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();

function lot(
	lotRef: string,
	qty: string,
	opts: { ageDays?: number; expiresInDays?: number } = {}
): StockLotBalance {
	const { ageDays = 0, expiresInDays } = opts;
	return {
		lot_ref: lotRef,
		item_id: 'item_master:x',
		unit: 'ชิ้น',
		qty,
		received_at: at(-ageDays),
		...(expiresInDays !== undefined ? { lot: { expiry: at(expiresInDays) } } : {})
	};
}

describe('planLotSplit (CR-143 FR-A7, FR-A11)', () => {
	it('AC-A5: 30 from lots 6 / 20 / 16 plans 3 rows of 6 / 20 / 4', () => {
		const lots = [lot('L1', '6'), lot('L2', '20'), lot('L3', '16')];
		const plan = planLotSplit(lots, '30', NOW);
		expect(plan.allocations.map((a) => [a.lot_ref, a.qty])).toEqual([
			['L1', '6'],
			['L2', '20'],
			['L3', '4']
		]);
		expect(plan.planned).toBe('30');
		expect(plan.shortfall).toBe('0');
		expect(plan.complete).toBe(true);
	});

	it('exact fit: the request equals the total, so every lot is emptied', () => {
		const plan = planLotSplit([lot('L1', '6'), lot('L2', '20'), lot('L3', '16')], '42', NOW);
		expect(plan.allocations.map((a) => a.qty)).toEqual(['6', '20', '16']);
		expect(plan.complete).toBe(true);
	});

	it('exact fit on the first lot: one row, later lots are untouched', () => {
		const plan = planLotSplit([lot('L1', '6'), lot('L2', '20')], '6', NOW);
		expect(plan.allocations.map((a) => [a.lot_ref, a.qty])).toEqual([['L1', '6']]);
	});

	it('fits inside the first lot: a single row (the old single-lot behaviour)', () => {
		const plan = planLotSplit([lot('L1', '10'), lot('L2', '20')], '4', NOW);
		expect(plan.allocations.map((a) => [a.lot_ref, a.qty])).toEqual([['L1', '4']]);
		expect(plan.complete).toBe(true);
	});

	it('FR-A11: not enough in total is incomplete and reports what is available', () => {
		const plan = planLotSplit([lot('L1', '6'), lot('L2', '20')], '30', NOW);
		expect(plan.complete).toBe(false);
		expect(plan.available).toBe('26');
		expect(plan.planned).toBe('26');
		expect(plan.shortfall).toBe('4');
	});

	it('AC-A4: skips an expired lot even when it ranks first, and reports it', () => {
		const expired = lot('OLD', '50', { expiresInDays: -1 });
		const plan = planLotSplit([expired, lot('L2', '5'), lot('L3', '10')], '12', NOW);
		expect(plan.allocations.map((a) => [a.lot_ref, a.qty])).toEqual([
			['L2', '5'],
			['L3', '7']
		]);
		expect(plan.skippedExpired.map((l) => l.lot_ref)).toEqual(['OLD']);
		expect(plan.available).toBe('15');
	});

	it('AC-A4: expired stock does not count towards what is available', () => {
		const plan = planLotSplit([lot('OLD', '50', { expiresInDays: 0 }), lot('L2', '5')], '10', NOW);
		expect(plan.complete).toBe(false);
		expect(plan.available).toBe('5');
		expect(plan.shortfall).toBe('5');
	});

	it('follows the given order and ignores lots with nothing left', () => {
		const plan = planLotSplit([lot('E', '0'), lot('L2', '3'), lot('L3', '5')], '4', NOW);
		expect(plan.allocations.map((a) => [a.lot_ref, a.qty])).toEqual([
			['L2', '3'],
			['L3', '1']
		]);
	});

	it('keeps decimal quantities exact', () => {
		const plan = planLotSplit([lot('L1', '0.1'), lot('L2', '0.25')], '0.3', NOW);
		expect(plan.allocations.map((a) => a.qty)).toEqual(['0.1', '0.2']);
		expect(plan.shortfall).toBe('0');
	});

	it('a zero or negative request plans nothing and is not complete', () => {
		for (const qty of ['0', '-3']) {
			const plan = planLotSplit([lot('L1', '6')], qty, NOW);
			expect(plan.allocations).toEqual([]);
			expect(plan.complete).toBe(false);
			expect(plan.shortfall).toBe('0');
		}
	});

	it('allocations carry the lot so the UI can show where each row comes from', () => {
		const lots = [lot('L1', '6')];
		expect(planLotSplit(lots, '2', NOW).allocations[0].lot).toBe(lots[0]);
	});

	it('plans in the FR-A3 order when fed rankLotsForIssue (expiring lot drains first)', () => {
		const soon = lot('SOON', '5', { expiresInDays: 3, ageDays: 30 });
		const dry = lot('DRY', '20', { ageDays: 365 });
		const ranked = rankLotsForIssue([dry, soon], undefined, NOW, { excludeExpired: true });
		const plan = planLotSplit(ranked, '8', NOW);
		expect(plan.allocations.map((a) => [a.lot_ref, a.qty])).toEqual([
			['SOON', '5'],
			['DRY', '3']
		]);
	});

	it('skips a lot with no expiry whose shelf life is used up when priorityItems are given (CR-156 FR-A4a, AC-A7)', () => {
		const items = new Map([['item_master:x', { shelf_life_days: 30 }]]);
		const spent = lot('SPENT', '8', { ageDays: 60 });
		const fresh = lot('FRESH', '2', { ageDays: 5 });
		const plan = planLotSplit([fresh, spent], '11', NOW, items);
		expect(plan.allocations.map((a) => [a.lot_ref, a.qty])).toEqual([['FRESH', '2']]);
		expect(plan.skippedExpired.map((l) => l.lot_ref)).toEqual(['SPENT']);
		expect(plan.available).toBe('2');
		expect(plan.shortfall).toBe('9');
		expect(plan.complete).toBe(false);
	});

	it('without priorityItems only lot.expiry decides (backward compatible)', () => {
		const spent = lot('SPENT', '8', { ageDays: 60 });
		expect(planLotSplit([spent], '8', NOW).complete).toBe(true);
	});

	it('does not treat a lot past only the storage-type HORIZON as expired (FR-A4c, AC-A8)', () => {
		const items = new Map([['item_master:x', { storage_type: 'DRY' }]]);
		const old = lot('OLD', '8', { ageDays: 400 });
		const plan = planLotSplit([old], '8', NOW, items);
		expect(plan.skippedExpired).toEqual([]);
		expect(plan.complete).toBe(true);
	});
});
