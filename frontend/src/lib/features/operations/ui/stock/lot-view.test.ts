import { describe, expect, it } from 'vitest';
import type { StockLotBalance } from '../../domain/operations';
import { buildLotRows } from './lot-view';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-02T00:00:00.000Z');
const iso = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();

function lot(over: Partial<StockLotBalance> & { lot_ref: string }): StockLotBalance {
	return {
		item_id: 'item_master:rice',
		unit: 'ถุง',
		qty: '10',
		received_at: iso(-10),
		...over
	};
}

describe('buildLotRows', () => {
	it('orders lots by consumption order (earliest expiry first)', () => {
		const rows = buildLotRows(
			[
				lot({ lot_ref: 'late', lot: { expiry: iso(30) } }),
				lot({ lot_ref: 'soon', lot: { expiry: iso(5) } })
			],
			[],
			NOW
		);
		expect(rows.map((r) => r.lotRef)).toEqual(['soon', 'late']);
	});

	it('marks only the first lot as next', () => {
		const rows = buildLotRows(
			[
				lot({ lot_ref: 'a', lot: { expiry: iso(5) } }),
				lot({ lot_ref: 'b', lot: { expiry: iso(30) } })
			],
			[],
			NOW
		);
		expect(rows.map((r) => r.isNext)).toEqual([true, false]);
	});

	it('skips an expired lot when picking the next one', () => {
		const rows = buildLotRows(
			[
				lot({ lot_ref: 'old', lot: { expiry: iso(-2) } }),
				lot({ lot_ref: 'fresh', lot: { expiry: iso(20) } })
			],
			[],
			NOW
		);
		expect(rows[0]).toMatchObject({ lotRef: 'old', isExpired: true, isNext: false });
		expect(rows[1]).toMatchObject({ lotRef: 'fresh', isExpired: false, isNext: true });
	});

	it('marks nothing as next when every lot has expired', () => {
		const rows = buildLotRows([lot({ lot_ref: 'old', lot: { expiry: iso(-1) } })], [], NOW);
		expect(rows.some((r) => r.isNext)).toBe(false);
	});

	it('drops lots with no quantity left', () => {
		const rows = buildLotRows(
			[lot({ lot_ref: 'empty', qty: '0' }), lot({ lot_ref: 'left', qty: '4' })],
			[],
			NOW
		);
		expect(rows.map((r) => r.lotRef)).toEqual(['left']);
	});

	it('leaves expiry empty for a lot without one', () => {
		const [row] = buildLotRows([lot({ lot_ref: 'a' })], [], NOW);
		expect(row.expiry).toBeNull();
		expect(row.isExpired).toBe(false);
		expect(row.isNext).toBe(true);
	});

	it('resolves the storage name from the current storage point', () => {
		const [row] = buildLotRows(
			[lot({ lot_ref: 'a', lot: { storage_point_id: 'sp1', storage_zone: 'old name' } })],
			[{ id: 'sp1', name: 'ห้องเย็น' }],
			NOW
		);
		expect(row.storageName).toBe('ห้องเย็น');
	});
});
