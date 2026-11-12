import { describe, expect, it } from 'vitest';
import {
	M6_STATUSES,
	catalogItemSchema,
	isCancellable,
	needsM6Coordination,
	stockItemSchema,
	withdrawalStatusMeta,
	withdrawalTotals,
	withdrawalViewSchema
} from './central-warehouse.schema';

describe('withdrawalStatusMeta', () => {
	it('labels every M6 status in Thai', () => {
		expect(withdrawalStatusMeta('pending').label).toBe('รอ M6 พิจารณา');
		expect(withdrawalStatusMeta('approved').label).toBe('อนุมัติแล้ว');
		expect(withdrawalStatusMeta('partially_approved').label).toBe('อนุมัติบางส่วน');
		expect(withdrawalStatusMeta('in_transit').label).toBe('กำลังจัดส่ง');
		expect(withdrawalStatusMeta('issued').label).toBe('M6 ปิดใบโดยไม่มีการจัดส่ง');
		expect(withdrawalStatusMeta('received').label).toBe('รับของแล้ว');
		expect(withdrawalStatusMeta('rejected').label).toBe('ไม่อนุมัติ');
		expect(withdrawalStatusMeta('cancelled').label).toBe('ยกเลิกแล้ว');
		expect(M6_STATUSES).toHaveLength(8);
	});

	it('shows an unknown status as-is in a muted tone', () => {
		expect(withdrawalStatusMeta('on_hold')).toEqual({ label: 'on_hold', tone: 'muted' });
	});
});

describe('status rules', () => {
	it('only pending is cancellable', () => {
		for (const s of M6_STATUSES) expect(isCancellable(s)).toBe(s === 'pending');
	});

	it('only issued needs coordination with M6', () => {
		for (const s of M6_STATUSES) expect(needsM6Coordination(s)).toBe(s === 'issued');
	});
});

describe('withdrawalTotals', () => {
	const line = (qty: number, qty_fulfilled: number | null) => ({
		item_code: String(qty),
		name: 'x',
		unit: 'u',
		qty,
		qty_fulfilled
	});

	it('sums requested and fulfilled', () => {
		expect(withdrawalTotals({ lines: [line(10, 8), line(5, 5)] })).toEqual({
			requested: 15,
			fulfilled: 13
		});
	});

	it('keeps fulfilled null until M6 has answered', () => {
		expect(withdrawalTotals({ lines: [line(10, null)] })).toEqual({
			requested: 10,
			fulfilled: null
		});
	});
});

describe('wire schemas', () => {
	it('accepts a FastAPI withdrawal view with nullable fields', () => {
		const parsed = withdrawalViewSchema.parse({
			external_ref: 'TENT-SH001-1',
			request_code: 'WR-1',
			shelter_code: 'SH001',
			status: 'pending',
			source_warehouse_code: 'WH1',
			source_warehouse_name: null,
			lines: [
				{ item_code: 'A', name: 'a', unit: 'u', type_code: null, qty: 2, qty_fulfilled: null }
			],
			reason: 'r',
			requested_by: { name: 'x', username: null },
			submitted_at: null,
			live: false
		});
		expect(parsed.lines[0].qty).toBe(2);
	});

	it('defaults a catalog warehouses_count and accepts numeric ids', () => {
		const item = catalogItemSchema.parse({ reference_id: 12, name_th: 'น้ำ' });
		expect(item.warehouses_count).toBe(0);
	});

	it('parses a stock row', () => {
		expect(
			stockItemSchema.parse({
				item_code: 'A',
				name: 'a',
				type_code: 'water',
				unit: 'u',
				on_hand: 10,
				available: 8
			}).available
		).toBe(8);
	});
});
