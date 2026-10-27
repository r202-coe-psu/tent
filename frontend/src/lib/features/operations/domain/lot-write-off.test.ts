import { describe, expect, it } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import {
	assertLotWriteOffsFit,
	createStockLedger,
	LotWriteOffError,
	projectLotsByItem,
	type StockLedger
} from './operations';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'staff1' };

const inbound = (item_id: string, qty: string, unit = 'kg') =>
	createStockLedger(
		{ item_id, qty, unit, reason: 'donation', ref_id: 'donation:d1', lot: { storage_zone: 'A' } },
		ctx
	);

const writeOff = (lot: StockLedger, qty: string, unit = lot.unit) => ({
	item_id: lot.item_id,
	unit,
	qty,
	lot_ref: lot._id
});

describe('assertLotWriteOffsFit (#569)', () => {
	const lotA = inbound('item:rice', '5');
	const lotB = inbound('item:rice', '100');
	const ledger = [lotA, lotB];

	it('lets a write-off that fits its lot through', () => {
		expect(() => assertLotWriteOffsFit(ledger, [writeOff(lotA, '-5')])).not.toThrow();
	});

	it("refuses one larger than its lot, though the item's other lot covers it", () => {
		expect(() => assertLotWriteOffsFit(ledger, [writeOff(lotA, '-6')])).toThrow(LotWriteOffError);
	});

	it('sums several rows on one lot', () => {
		expect(() =>
			assertLotWriteOffsFit(ledger, [writeOff(lotA, '-3'), writeOff(lotA, '-3')])
		).toThrow(/ไม่พอตัด/);
	});

	it('refuses a lot that is gone, another item’s, or in another unit', () => {
		const salt = inbound('item:salt', '9');
		expect(() =>
			assertLotWriteOffsFit(ledger, [{ ...writeOff(salt, '-1'), item_id: 'item:rice' }])
		).toThrow(/ไม่พบล็อตที่เลือก/);
		expect(() => assertLotWriteOffsFit(ledger, [writeOff(lotA, '-1', 'ถุง')])).toThrow(
			/ไม่พบล็อตที่เลือก/
		);
	});

	it('ignores rows that add stock or name no lot', () => {
		expect(() =>
			assertLotWriteOffsFit(ledger, [
				writeOff(lotA, '50'),
				{ item_id: 'item:rice', unit: 'kg', qty: '-500' }
			])
		).not.toThrow();
	});
});

describe('assertLotWriteOffsFit — a history that cannot be replayed (#856)', () => {
	it('tells the user in Thai instead of leaking the projection error', () => {
		const rice = inbound('item:rice', '5');
		const overdrawn = createStockLedger(
			{
				item_id: 'item:rice',
				qty: '-9',
				unit: 'kg',
				reason: 'adjust',
				adjust_reason: 'lost',
				ref_id: null,
				lot_ref: rice._id
			},
			ctx
		);
		const attempt = () => assertLotWriteOffsFit([rice, overdrawn], [writeOff(rice, '-1')]);

		expect(attempt).toThrow(LotWriteOffError);
		expect(attempt).toThrow('ประวัติคลังของสินค้านี้คำนวณยอดรายล็อตไม่ได้');
	});
});

describe('projectLotsByItem (#569)', () => {
	it('drops only the item whose history cannot be replayed, and names it', () => {
		const rice = inbound('item:rice', '5');
		const overdrawn = createStockLedger(
			{
				item_id: 'item:rice',
				qty: '-9',
				unit: 'kg',
				reason: 'adjust',
				adjust_reason: 'lost',
				ref_id: null,
				lot_ref: rice._id
			},
			ctx
		);
		const salt = inbound('item:salt', '4');

		const { lots, brokenItemIds } = projectLotsByItem([rice, overdrawn, salt]);

		expect(brokenItemIds).toEqual(['item:rice']);
		expect(lots.map((lot) => lot.item_id)).toEqual(['item:salt']);
	});

	it('rethrows anything that is not a broken history', () => {
		// rows with no `occurred_at` cannot even be ordered — a bug, not a broken history
		const bad = (qty: string) =>
			({ ...inbound('item:rice', qty), occurred_at: undefined }) as unknown as StockLedger;
		expect(() => projectLotsByItem([bad('5'), bad('1')])).toThrow(TypeError);
	});
});
