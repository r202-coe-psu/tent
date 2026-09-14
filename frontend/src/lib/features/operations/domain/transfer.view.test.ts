import { describe, it, expect } from 'vitest';
import type { StockTransfer } from './operations';
import {
	transferLineKeys,
	transferSide,
	transferStatusReason,
	transferTimelineSteps
} from './transfer.view';

const REQUESTED = { at: '2026-08-22T05:00:00.000Z', by: 'staff_a' };
const DISPUTED = { at: '2026-08-22T06:00:00.000Z', by: 'staff_b' };
const SHIPPED = { at: '2026-08-22T07:00:00.000Z', by: 'staff_a' };
const RECEIVED = { at: '2026-08-22T09:00:00.000Z', by: 'staff_b' };

function transfer(overrides?: Partial<StockTransfer>): StockTransfer {
	return {
		_id: 'stock_transfer:01TRANSFER0000000000000000',
		type: 'stock_transfer',
		schema_v: 3,
		shelter_code: 'SH001',
		created_at: REQUESTED.at,
		updated_at: REQUESTED.at,
		created_by: 'staff_a',
		from_shelter: 'SH001',
		to_shelter: 'SH002',
		items: [{ item_id: 'item:rice', qty: '100', unit: 'kg' }],
		status: 'requested',
		timeline: { requested: REQUESTED },
		...overrides
	} as StockTransfer;
}

describe('transferSide', () => {
	it('returns source when the viewing shelter is from_shelter', () => {
		expect(transferSide(transfer(), 'SH001')).toBe('source');
	});

	it('returns destination when the viewing shelter is to_shelter', () => {
		expect(transferSide(transfer(), 'SH002')).toBe('destination');
	});

	it('returns none when the viewing shelter is neither end (SA on another shelter)', () => {
		expect(transferSide(transfer(), 'SH003')).toBe('none');
	});
});

describe('transferStatusReason', () => {
	it('shows dispute_reason for a disputed transfer', () => {
		const t = transfer({ status: 'disputed', dispute_reason: 'จำนวนไม่ตรง' });
		expect(transferStatusReason(t)).toBe('จำนวนไม่ตรง');
	});

	it('shows cancel_reason for a cancelled transfer', () => {
		const t = transfer({ status: 'cancelled', cancel_reason: 'สั่งซ้ำ' });
		expect(transferStatusReason(t)).toBe('สั่งซ้ำ');
	});

	it('ignores a stale reason left on a requested transfer', () => {
		const t = transfer({ cancel_reason: 'ค้างจาก build เก่า', dispute_reason: 'ค้าง' });
		expect(transferStatusReason(t)).toBeUndefined();
	});

	it('does not show cancel_reason under disputed', () => {
		const t = transfer({ status: 'disputed', cancel_reason: 'ค้าง' });
		expect(transferStatusReason(t)).toBeUndefined();
	});
});

describe('transferTimelineSteps', () => {
	it('returns only the requested step for a new transfer', () => {
		expect(transferTimelineSteps(transfer())).toEqual([{ key: 'requested', ...REQUESTED }]);
	});

	it('orders requested, shipped and received', () => {
		const t = transfer({
			status: 'received',
			timeline: { received: RECEIVED, shipped: SHIPPED, requested: REQUESTED }
		});
		expect(transferTimelineSteps(t).map((s) => s.key)).toEqual([
			'requested',
			'shipped',
			'received'
		]);
	});

	it('keeps the disputed step after a resume, between requested and shipped', () => {
		const t = transfer({
			status: 'shipped',
			timeline: { requested: REQUESTED, shipped: SHIPPED, disputed: DISPUTED }
		});
		expect(transferTimelineSteps(t)).toEqual([
			{ key: 'requested', ...REQUESTED },
			{ key: 'disputed', ...DISPUTED },
			{ key: 'shipped', ...SHIPPED }
		]);
	});

	it('adds no step for a cancelled transfer', () => {
		const t = transfer({ status: 'cancelled', cancel_reason: 'สั่งซ้ำ' });
		expect(transferTimelineSteps(t).map((s) => s.key)).toEqual(['requested']);
	});
});

describe('transferLineKeys', () => {
	it('returns one key per line for distinct item_ids', () => {
		const t = transfer({
			items: [
				{ item_id: 'item:rice', qty: '100', unit: 'kg' },
				{ item_id: 'item:water', qty: '20', unit: 'pack' }
			]
		});
		expect(transferLineKeys(t)).toEqual(['item:rice#0', 'item:water#0']);
	});

	it('gives repeated item_id lines distinct keys that are stable across calls', () => {
		const t = transfer({
			items: [
				{ item_id: 'item:rice', qty: '60', unit: 'kg' },
				{ item_id: 'item:water', qty: '20', unit: 'pack' },
				{ item_id: 'item:rice', qty: '40', unit: 'kg' }
			]
		});
		const keys = transferLineKeys(t);
		expect(keys).toHaveLength(3);
		expect(new Set(keys).size).toBe(3);
		expect(transferLineKeys(t)).toEqual(keys);
	});
});
