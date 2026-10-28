import { describe, expect, it } from 'vitest';
import {
	applyBatchRun,
	availableForLine,
	checkDistributeBatch,
	emptyDistributeLine,
	hasLandedRows,
	parseDistributeNote,
	planBatchWrites,
	summarizeBatch,
	withLineItem,
	type DistributeCheckContext,
	type DistributeLineDraft,
	type DistributeLineVerdict
} from './distribute-batch';
import type { StockLotBalance } from './operations';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-02T00:00:00.000Z');
const at = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();

function lot(
	itemId: string,
	lotRef: string,
	qty: string,
	opts: { ageDays?: number; expiresInDays?: number; unit?: string } = {}
): StockLotBalance {
	const { ageDays = 0, expiresInDays, unit = 'ชิ้น' } = opts;
	return {
		lot_ref: lotRef,
		item_id: itemId,
		unit,
		qty,
		received_at: at(-ageDays),
		...(expiresInDays !== undefined ? { lot: { expiry: at(expiresInDays) } } : {})
	};
}

const RICE = 'item:rice';
const WATER = 'item:water';

const ctx = (over: Partial<DistributeCheckContext> = {}): DistributeCheckContext => ({
	lots: [
		lot(RICE, 'stock_ledger:R1', '6', { ageDays: 3 }),
		lot(RICE, 'stock_ledger:R2', '20', { ageDays: 1 }),
		lot(WATER, 'stock_ledger:W1', '100', { unit: 'ขวด' })
	],
	packaging: new Map([
		[RICE, { base_unit: 'ชิ้น', conversions: [] }],
		[WATER, { base_unit: 'ขวด', conversions: [{ uom_name: 'แพ็ค', multiplier: '12' }] }]
	]),
	priorityItems: new Map(),
	reorder: new Map(),
	occupancy: 100,
	now: NOW,
	...over
});

function line(over: Partial<DistributeLineDraft>): DistributeLineDraft {
	return { ...emptyDistributeLine(over.key ?? 'k'), ...over };
}

const kinds = (vs: DistributeLineVerdict[]) => vs.map((v) => v.kind);

describe('checkDistributeBatch: balance per line (#837)', () => {
	it('plans every line from its own lots; one short line blocks the whole save', () => {
		const lines = [
			line({ key: 'a', item_id: RICE, qty: '30', unit: 'ชิ้น' }),
			line({ key: 'b', item_id: WATER, qty: '5', unit: 'ขวด' })
		];
		const check = checkDistributeBatch(lines, ctx());

		expect(check.verdicts[0]).toMatchObject({ kind: 'short', requested: '30', available: '26' });
		expect(check.verdicts[1].kind).toBe('ok');
		expect(check.canSave).toBe(false);
	});

	it('all lines ok: can save, rice splits across both lots oldest first', () => {
		const lines = [
			line({ key: 'a', item_id: RICE, qty: '10', unit: 'ชิ้น' }),
			line({ key: 'b', item_id: WATER, qty: '2', unit: 'แพ็ค' })
		];
		const check = checkDistributeBatch(lines, ctx());

		expect(check.canSave).toBe(true);
		const [rice, water] = check.verdicts;
		if (rice.kind !== 'ok' || water.kind !== 'ok') throw new Error('expected ok verdicts');
		expect(rice.plan.allocations.map((a) => [a.lot_ref, a.qty])).toEqual([
			['stock_ledger:R1', '6'],
			['stock_ledger:R2', '4']
		]);
		expect(water.baseQty).toBe('24');
	});

	it('converts the typed unit to the base unit before comparing with the balance', () => {
		const check = checkDistributeBatch([line({ item_id: WATER, qty: '9', unit: 'แพ็ค' })], ctx());
		expect(check.verdicts[0]).toMatchObject({ kind: 'short', requested: '108', available: '100' });
	});

	it('an expired lot adds nothing to what auto mode can issue', () => {
		const lots = [
			lot(RICE, 'stock_ledger:OLD', '50', { expiresInDays: -1 }),
			lot(RICE, 'stock_ledger:R1', '6')
		];
		const check = checkDistributeBatch(
			[line({ item_id: RICE, qty: '10', unit: 'ชิ้น' })],
			ctx({ lots })
		);
		expect(check.verdicts[0]).toMatchObject({ kind: 'short', available: '6' });
	});

	it('single-lot mode issues one row from the chosen lot and is short against that lot only', () => {
		const ok = checkDistributeBatch(
			[
				line({
					item_id: RICE,
					qty: '6',
					unit: 'ชิ้น',
					lot: { mode: 'single', lot_ref: 'stock_ledger:R1' }
				})
			],
			ctx()
		);
		const verdict = ok.verdicts[0];
		if (verdict.kind !== 'ok') throw new Error('expected ok');
		expect(verdict.plan.allocations.map((a) => [a.lot_ref, a.qty])).toEqual([
			['stock_ledger:R1', '6']
		]);

		const short = checkDistributeBatch(
			[
				line({
					item_id: RICE,
					qty: '7',
					unit: 'ชิ้น',
					lot: { mode: 'single', lot_ref: 'stock_ledger:R1' }
				})
			],
			ctx()
		);
		expect(short.verdicts[0]).toMatchObject({ kind: 'short', requested: '7', available: '6' });
	});

	it('names what is missing on an unfinished line', () => {
		const SALT = 'item:salt';
		const salt = lot(SALT, 'stock_ledger:S1', '9');
		const lines = [
			line({ key: 'a' }),
			line({ key: 'b', item_id: RICE, unit: 'ชิ้น' }),
			line({ key: 'd', item_id: WATER, qty: '1', unit: 'ลัง' }),
			line({
				key: 'e',
				item_id: SALT,
				qty: '1',
				unit: 'ชิ้น',
				lot: { mode: 'single', lot_ref: '' }
			})
		];
		const base = ctx();
		const verdicts = checkDistributeBatch(
			lines,
			ctx({
				lots: [...base.lots, salt],
				packaging: new Map([...base.packaging, [SALT, { base_unit: 'ชิ้น', conversions: [] }]])
			})
		).verdicts;
		expect(verdicts.map((v) => (v.kind === 'incomplete' ? v.missing : v.kind))).toEqual([
			'item',
			'qty',
			'unit',
			'lot'
		]);
	});
});

describe('checkDistributeBatch: duplicate items (#837)', () => {
	it('flags the later line, not the first, and blocks saving', () => {
		const lines = [
			line({ key: 'a', item_id: RICE, qty: '1', unit: 'ชิ้น' }),
			line({ key: 'b', item_id: WATER, qty: '1', unit: 'ขวด' }),
			line({ key: 'c', item_id: RICE, qty: '1', unit: 'ชิ้น' })
		];
		const check = checkDistributeBatch(lines, ctx());
		expect(kinds(check.verdicts)).toEqual(['ok', 'ok', 'duplicate']);
		expect(check.canSave).toBe(false);
	});

	it('an item already issued on a done line cannot be picked again on a new line', () => {
		const lines = [
			line({
				key: 'a',
				item_id: RICE,
				qty: '1',
				unit: 'ชิ้น',
				status: { kind: 'done', distributedQty: '1' }
			}),
			line({ key: 'b', item_id: RICE, qty: '1', unit: 'ชิ้น' })
		];
		expect(kinds(checkDistributeBatch(lines, ctx()).verdicts)).toEqual(['done', 'duplicate']);
	});

	it('a duplicate is flagged even before its quantity is typed', () => {
		const lines = [
			line({ key: 'a', item_id: RICE, qty: '1', unit: 'ชิ้น' }),
			line({ key: 'b', item_id: RICE })
		];
		expect(kinds(checkDistributeBatch(lines, ctx()).verdicts)).toEqual(['ok', 'duplicate']);
	});
});

describe('checkDistributeBatch: below-threshold warning', () => {
	const reorder = new Map([[RICE, { item: { reorder_level: 20 }, override: null }]]);

	it('warns, without blocking, when what stays on hand is at or under the threshold', () => {
		const check = checkDistributeBatch(
			[line({ item_id: RICE, qty: '10', unit: 'ชิ้น' })],
			ctx({ reorder })
		);
		const verdict = check.verdicts[0];
		if (verdict.kind !== 'ok') throw new Error('expected ok');
		expect(verdict.lowStock).toEqual({ remaining: '16', threshold: '20', coverDays: null });
		expect(check.canSave).toBe(true);
	});

	it('stays quiet while the remainder is above the threshold or no policy exists', () => {
		const above = checkDistributeBatch(
			[line({ item_id: RICE, qty: '1', unit: 'ชิ้น' })],
			ctx({ reorder: new Map([[RICE, { item: { reorder_level: 10 }, override: null }]]) })
		);
		const none = checkDistributeBatch([line({ item_id: RICE, qty: '1', unit: 'ชิ้น' })], ctx());
		for (const check of [above, none]) {
			const verdict = check.verdicts[0];
			expect(verdict.kind === 'ok' && verdict.lowStock).toBeNull();
		}
	});
});

describe('availableForLine', () => {
	const ranked = [
		lot(RICE, 'stock_ledger:OLD', '50', { expiresInDays: -1 }),
		lot(RICE, 'stock_ledger:R1', '6')
	];
	it('auto: usable lots only; single: the chosen lot, expired or not', () => {
		expect(availableForLine({ mode: 'auto' }, ranked, new Map(), NOW)).toBe('6');
		expect(
			availableForLine({ mode: 'single', lot_ref: 'stock_ledger:OLD' }, ranked, new Map(), NOW)
		).toBe('50');
		expect(availableForLine({ mode: 'single', lot_ref: 'gone' }, ranked, new Map(), NOW)).toBe('0');
	});
});

describe('planBatchWrites', () => {
	it('keeps display order and leaves out done lines', () => {
		const lines = [
			line({
				key: 'a',
				item_id: RICE,
				qty: '1',
				unit: 'ชิ้น',
				status: { kind: 'done', distributedQty: '1' }
			}),
			line({ key: 'b', item_id: WATER, qty: '3', unit: 'ขวด' })
		];
		const plans = planBatchWrites(lines, checkDistributeBatch(lines, ctx()));
		expect(plans.map((p) => [p.key, p.item_id])).toEqual([['b', WATER]]);
		expect(plans[0].allocations.map((a) => a.qty)).toEqual(['3']);
	});
});

describe('summarizeBatch', () => {
	it('lists every ready line with its lots, the done ones, and skips lines not ready yet', () => {
		const lines = [
			line({ key: 'a', item_id: RICE, qty: '10', unit: 'ชิ้น' }),
			line({ key: 'b', item_id: WATER, qty: '2', unit: 'แพ็ค' }),
			line({ key: 'c', item_id: 'item:salt', qty: '', unit: 'ถุง' }),
			line({
				key: 'd',
				item_id: 'item:soap',
				qty: '4',
				unit: 'ก้อน',
				status: { kind: 'done', distributedQty: '4' }
			})
		];
		const summary = summarizeBatch(lines, checkDistributeBatch(lines, ctx()));

		expect(summary.entries.map((e) => [e.key, e.kind])).toEqual([
			['a', 'ready'],
			['b', 'ready'],
			['d', 'done']
		]);
		const [rice, water, soap] = summary.entries;
		if (rice.kind !== 'ready' || water.kind !== 'ready') throw new Error('expected ready entries');
		expect(rice.allocations.map((a) => [a.lot_ref, a.qty])).toEqual([
			['stock_ledger:R1', '6'],
			['stock_ledger:R2', '4']
		]);
		expect([water.qty, water.unit, water.baseQty]).toEqual(['2', 'แพ็ค', '24']);
		expect(soap).toMatchObject({ kind: 'done', landed: '4' });
		expect(summary.readyCount).toBe(2);
		expect(summary.rowCount).toBe(3);
	});

	it('keeps what a partial run already landed on a ready line', () => {
		const lines = [
			line({
				key: 'a',
				item_id: RICE,
				qty: '4',
				unit: 'ชิ้น',
				status: { kind: 'failed', message: 'x', distributedQty: '6' }
			})
		];
		const [entry] = summarizeBatch(lines, checkDistributeBatch(lines, ctx())).entries;
		expect(entry).toMatchObject({ kind: 'ready', baseQty: '4', landed: '6' });
	});

	it('is empty while no line is ready', () => {
		const lines = [line({ key: 'a', item_id: RICE, qty: '99', unit: 'ชิ้น' })];
		expect(summarizeBatch(lines, checkDistributeBatch(lines, ctx()))).toEqual({
			entries: [],
			readyCount: 0,
			rowCount: 0
		});
	});
});

describe('applyBatchRun: partial save (FR-A9)', () => {
	const lines = [
		line({ key: 'a', item_id: RICE, qty: '30', unit: 'ชิ้น' }),
		line({ key: 'b', item_id: WATER, qty: '2', unit: 'แพ็ค' }),
		line({ key: 'c', item_id: 'item:salt', qty: '1', unit: 'ถุง' })
	];

	it('locks done lines, shrinks the partly cut one to its base-unit remainder, leaves the rest', () => {
		const next = applyBatchRun(lines, [
			{ kind: 'done', key: 'a', distributedQty: '30' },
			{
				kind: 'partial',
				key: 'b',
				distributedQty: '12',
				remainingQty: '12',
				unit: 'ขวด',
				message: 'offline'
			},
			{ kind: 'not_attempted', key: 'c' }
		]);

		expect(next[0].status).toEqual({ kind: 'done', distributedQty: '30' });
		expect(next[1]).toMatchObject({
			qty: '12',
			unit: 'ขวด',
			status: { kind: 'failed', message: 'offline', distributedQty: '12' }
		});
		expect(next[2]).toEqual(lines[2]);
		expect(hasLandedRows(next[1])).toBe(true);
		expect(hasLandedRows(next[2])).toBe(false);
	});

	it('a first-row failure keeps the line as typed, with nothing landed', () => {
		const next = applyBatchRun(lines, [{ kind: 'failed', key: 'a', message: 'offline' }]);
		expect(next[0]).toMatchObject({
			qty: '30',
			unit: 'ชิ้น',
			status: { kind: 'failed', message: 'offline', distributedQty: '0' }
		});
		expect(hasLandedRows(next[0])).toBe(false);
	});

	it('a retry adds to what already landed instead of replacing it', () => {
		const first = applyBatchRun(lines, [
			{
				kind: 'partial',
				key: 'a',
				distributedQty: '6',
				remainingQty: '24',
				unit: 'ชิ้น',
				message: 'offline'
			}
		]);
		const second = applyBatchRun(first, [{ kind: 'done', key: 'a', distributedQty: '24' }]);
		expect(second[0].status).toEqual({ kind: 'done', distributedQty: '30' });
	});

	it('the retry plans only the unlocked lines, from the remainder', () => {
		const afterRun = applyBatchRun(lines, [
			{ kind: 'done', key: 'a', distributedQty: '30' },
			{
				kind: 'partial',
				key: 'b',
				distributedQty: '12',
				remainingQty: '12',
				unit: 'ขวด',
				message: 'offline'
			},
			{ kind: 'not_attempted', key: 'c' }
		]);
		const afterLots = ctx({
			lots: [lot(WATER, 'stock_ledger:W1', '88', { unit: 'ขวด' })]
		});
		const check = checkDistributeBatch(afterRun.slice(0, 2), afterLots);
		const plans = planBatchWrites(afterRun.slice(0, 2), check);
		expect(plans.map((p) => p.key)).toEqual(['b']);
		expect(plans[0].allocations.map((a) => [a.lot_ref, a.qty])).toEqual([
			['stock_ledger:W1', '12']
		]);
	});
});

describe('line helpers', () => {
	it('withLineItem resets qty and lot and takes the item issue unit', () => {
		const typed = line({ key: 'x', item_id: RICE, qty: '5', unit: 'ชิ้น' });
		const next = withLineItem(typed, {
			_id: WATER,
			base_unit: 'ขวด',
			conversions: [{ uom_name: 'แพ็ค', multiplier: '12' }],
			default_issue_uom: 'แพ็ค'
		});
		expect(next).toMatchObject({
			key: 'x',
			item_id: WATER,
			qty: '',
			unit: 'แพ็ค',
			lot: { mode: 'auto' }
		});
		expect(withLineItem(next, null)).toMatchObject({ item_id: '', unit: '' });
	});

	it('parseDistributeNote keeps the destination rules of a single issue', () => {
		expect(parseDistributeNote('  ครัวกลาง ')).toEqual({ ok: true, value: 'ครัวกลาง' });
		expect(parseDistributeNote('   ')).toMatchObject({ ok: false });
		expect(parseDistributeNote('ก'.repeat(101))).toMatchObject({ ok: false });
	});
});
