import { describe, it, expect } from 'vitest';
import type { DistributionRequest } from '../domain/distribution';
import type { StockLotBalance } from '$lib/features/operations';
import {
	filterLotsForItem,
	getLotInputKey,
	calculateItemAllocation,
	buildApprovalPlan,
	validateApprovalPlan,
	buildApprovalAllocations
} from './approval-allocation-form';

function makeMockRequest(
	items: Array<{ item_id: string; requested_qty: string; unit: string }>
): DistributionRequest {
	return {
		_id: 'distribution_request:01J8F2MOCKREQ00000000000',
		type: 'distribution_request',
		schema_v: 1,
		shelter_code: 'SHELD01',
		created_at: '2026-09-01T00:00:00.000Z',
		updated_at: '2026-09-01T00:00:00.000Z',
		created_by: 'staff_1',
		status: 'pending',
		requested_by: 'staff_1',
		requested_at: '2026-09-01T00:00:00.000Z',
		purpose: 'Emergency Blanket and Water',
		active_headcount_snapshot: '100',
		buffer_percent: 10,
		items: items.map((i) => ({
			item_id: i.item_id,
			requested_qty: i.requested_qty,
			unit: i.unit,
			distribution_type_snapshot: 'consumable',
			target_qty_snapshot: i.requested_qty
		}))
	};
}

describe('approval-allocation-form', () => {
	const sampleLots: StockLotBalance[] = [
		{
			lot_ref: 'stock_ledger:01J8LOT001',
			item_id: 'item_blanket',
			unit: 'ผืน',
			qty: '50',
			lot: { lot_no: 'LOT-2026-A', expiry: '2027-10-01', storage_zone: 'Zone 1' },
			received_at: '2026-08-01T00:00:00.000Z'
		},
		{
			lot_ref: 'stock_ledger:01J8LOT002',
			item_id: 'item_blanket',
			unit: 'ผืน',
			qty: '70',
			lot: { lot_no: 'LOT-2026-B', expiry: '2027-05-01', storage_zone: 'Zone 2' },
			received_at: '2026-08-05T00:00:00.000Z'
		},
		{
			lot_ref: 'stock_ledger:01J8LOT003',
			item_id: 'item_water',
			unit: 'ขวด',
			qty: '100',
			lot: { lot_no: 'LOT-2026-W1', expiry: '2028-01-01' },
			received_at: '2026-08-10T00:00:00.000Z'
		}
	];

	describe('filterLotsForItem and Operations FEFO integration', () => {
		it('filters lots by item_id, unit, and positive qty in canonical Operations consumption order', () => {
			const filtered = filterLotsForItem(sampleLots, 'item_blanket', 'ผืน');
			expect(filtered).toHaveLength(2);
			// Canonical Operations FEFO: 2027-05-01 before 2027-10-01
			expect(filtered[0].lot_ref).toBe('stock_ledger:01J8LOT002');
			expect(filtered[1].lot_ref).toBe('stock_ledger:01J8LOT001');
		});

		it('excludes zero/negative quantity lots', () => {
			const lotsWithZero: StockLotBalance[] = [
				...sampleLots,
				{
					lot_ref: 'stock_ledger:01J8LOT004_ZERO',
					item_id: 'item_blanket',
					unit: 'ผืน',
					qty: '0',
					received_at: '2026-08-01T00:00:00.000Z'
				}
			];
			const filtered = filterLotsForItem(lotsWithZero, 'item_blanket', 'ผืน');
			expect(filtered).toHaveLength(2);
			expect(filtered.map((l) => l.lot_ref)).not.toContain('stock_ledger:01J8LOT004_ZERO');
		});

		it('orders expiring lots before non-expiring lots via Operations authority', () => {
			const mixed: StockLotBalance[] = [
				{
					lot_ref: 'stock_ledger:NO-EXPIRY',
					item_id: 'item_blanket',
					unit: 'ผืน',
					qty: '10',
					received_at: '2026-08-01T00:00:00.000Z'
				},
				{
					lot_ref: 'stock_ledger:EXPIRING',
					item_id: 'item_blanket',
					unit: 'ผืน',
					qty: '10',
					lot: { expiry: '2027-12-31' },
					received_at: '2026-08-01T00:00:00.000Z'
				}
			];
			const filtered = filterLotsForItem(mixed, 'item_blanket');
			expect(filtered[0].lot_ref).toBe('stock_ledger:EXPIRING');
			expect(filtered[1].lot_ref).toBe('stock_ledger:NO-EXPIRY');
		});
	});

	describe('calculateItemAllocation', () => {
		const reqItem = {
			item_id: 'item_blanket',
			requested_qty: '100',
			unit: 'ผืน',
			distribution_type_snapshot: 'consumable' as const,
			target_qty_snapshot: '100'
		};

		it('calculates full allocation when allocated equals requested', () => {
			const lotInputMap = {
				'stock_ledger:01J8LOT002': '70',
				'stock_ledger:01J8LOT001': '30'
			};
			const plan = calculateItemAllocation(reqItem, 0, lotInputMap, sampleLots);
			expect(plan.allocated_qty).toBe('100');
			expect(plan.remaining_qty).toBe('0');
			expect(plan.status).toBe('full');
			expect(plan.isItemValid).toBe(true);
			expect(plan.errorMessage).toBeUndefined();
		});

		it('calculates partial allocation when allocated is positive but less than requested', () => {
			const lotInputMap = {
				'stock_ledger:01J8LOT002': '40'
			};
			const plan = calculateItemAllocation(reqItem, 0, lotInputMap, sampleLots);
			expect(plan.allocated_qty).toBe('40');
			expect(plan.remaining_qty).toBe('60');
			expect(plan.status).toBe('partial');
			expect(plan.isItemValid).toBe(true);
		});

		it('calculates unallocated when no lots have values', () => {
			const plan = calculateItemAllocation(reqItem, 0, {}, sampleLots);
			expect(plan.allocated_qty).toBe('0');
			expect(plan.remaining_qty).toBe('100');
			expect(plan.status).toBe('unallocated');
			expect(plan.isItemValid).toBe(true);
		});

		it('marks item as over when total allocated exceeds requested qty', () => {
			const lotInputMap = {
				'stock_ledger:01J8LOT002': '70',
				'stock_ledger:01J8LOT001': '40'
			};
			const plan = calculateItemAllocation(reqItem, 0, lotInputMap, sampleLots);
			expect(plan.allocated_qty).toBe('110');
			expect(plan.status).toBe('over');
			expect(plan.isItemValid).toBe(false);
			expect(plan.errorMessage).toContain('เกินจำนวนที่ร้องขอ');
		});

		it('marks item as over when single lot input exceeds lot available qty', () => {
			const lotInputMap = {
				'stock_ledger:01J8LOT002': '80' // available is 70
			};
			const plan = calculateItemAllocation(reqItem, 0, lotInputMap, sampleLots);
			expect(plan.status).toBe('over');
			expect(plan.isItemValid).toBe(false);
			expect(plan.lotEntries[0].isOverLot).toBe(true);
			expect(plan.errorMessage).toContain('เกินจำนวนคงเหลือ');
		});
	});

	describe('buildApprovalPlan and validateApprovalPlan', () => {
		it('validates a valid full approval plan across multiple items', () => {
			const request = makeMockRequest([
				{ item_id: 'item_blanket', requested_qty: '50', unit: 'ผืน' },
				{ item_id: 'item_water', requested_qty: '20', unit: 'ขวด' }
			]);

			const lotInputMap = {
				'stock_ledger:01J8LOT002': '50',
				'stock_ledger:01J8LOT003': '20'
			};

			const plans = buildApprovalPlan(request, lotInputMap, sampleLots);
			const validation = validateApprovalPlan(plans, sampleLots);

			expect(validation.isValid).toBe(true);
			expect(validation.totalAllocatedQty).toBe('70');
			expect(validation.positiveAllocationsCount).toBe(2);
			expect(validation.isPartial).toBe(false);
			expect(validation.errors).toHaveLength(0);
		});

		it('validates a valid partial approval plan', () => {
			const request = makeMockRequest([
				{ item_id: 'item_blanket', requested_qty: '50', unit: 'ผืน' },
				{ item_id: 'item_water', requested_qty: '20', unit: 'ขวด' }
			]);

			const lotInputMap = {
				'stock_ledger:01J8LOT002': '30' // partial for blanket, unallocated for water
			};

			const plans = buildApprovalPlan(request, lotInputMap, sampleLots);
			const validation = validateApprovalPlan(plans, sampleLots);

			expect(validation.isValid).toBe(true);
			expect(validation.totalAllocatedQty).toBe('30');
			expect(validation.positiveAllocationsCount).toBe(1);
			expect(validation.isPartial).toBe(true);
		});

		it('fails validation when total positive allocations is zero', () => {
			const request = makeMockRequest([
				{ item_id: 'item_blanket', requested_qty: '50', unit: 'ผืน' }
			]);

			const plans = buildApprovalPlan(request, {}, sampleLots);
			const validation = validateApprovalPlan(plans, sampleLots);

			expect(validation.isValid).toBe(false);
			expect(validation.errors).toContain('ต้องจัดสรรจำนวนอย่างน้อย 1 รายการเพื่ออนุมัติ');
		});
	});

	describe('Duplicate request items & global physical lot capacity validation', () => {
		it('detects and rejects global over-allocation when duplicate request rows target the same physical lot', () => {
			// Scenario: 2 rows requesting item_blanket (50 each), lot 01J8LOT001 has 50 available.
			const request = makeMockRequest([
				{ item_id: 'item_blanket', requested_qty: '50', unit: 'ผืน' },
				{ item_id: 'item_blanket', requested_qty: '50', unit: 'ผืน' }
			]);

			// Row 0 allocates 35 from LOT001, Row 1 allocates 25 from LOT001 (total 60 > 50 available)
			const keyRow0 = getLotInputKey('item_blanket', 0, 'stock_ledger:01J8LOT001');
			const keyRow1 = getLotInputKey('item_blanket', 1, 'stock_ledger:01J8LOT001');

			const lotInputMap = {
				[keyRow0]: '35',
				[keyRow1]: '25'
			};

			const plans = buildApprovalPlan(request, lotInputMap, sampleLots);
			const validation = validateApprovalPlan(plans, sampleLots);

			expect(validation.isValid).toBe(false);
			expect(validation.errors.some((e) => e.includes('เกินจำนวนคงเหลือในคลัง'))).toBe(true);
		});

		it('accepts valid split allocation across duplicate request rows and aggregates them in buildApprovalAllocations', () => {
			// Scenario: 2 rows requesting item_blanket (50 each), lot 01J8LOT001 has 50 available.
			const request = makeMockRequest([
				{ item_id: 'item_blanket', requested_qty: '50', unit: 'ผืน' },
				{ item_id: 'item_blanket', requested_qty: '50', unit: 'ผืน' }
			]);

			// Row 0 allocates 30 from LOT001, Row 1 allocates 20 from LOT001 (total 50 == 50 available)
			const keyRow0 = getLotInputKey('item_blanket', 0, 'stock_ledger:01J8LOT001');
			const keyRow1 = getLotInputKey('item_blanket', 1, 'stock_ledger:01J8LOT001');

			const lotInputMap = {
				[keyRow0]: '30',
				[keyRow1]: '20'
			};

			const plans = buildApprovalPlan(request, lotInputMap, sampleLots);
			const validation = validateApprovalPlan(plans, sampleLots);

			expect(validation.isValid).toBe(true);
			expect(validation.totalAllocatedQty).toBe('50');

			// buildApprovalAllocations aggregates allocations by (item_id, lot_ref) to avoid duplicate lines
			const allocations = buildApprovalAllocations(plans, sampleLots);
			expect(allocations).toHaveLength(1);
			expect(allocations[0]).toMatchObject({
				item_id: 'item_blanket',
				lot_ref: 'stock_ledger:01J8LOT001',
				qty: '50'
			});
		});
	});

	describe('buildApprovalAllocations', () => {
		it('drops empty and zero entries and copies lot metadata to output', () => {
			const request = makeMockRequest([
				{ item_id: 'item_blanket', requested_qty: '50', unit: 'ผืน' },
				{ item_id: 'item_water', requested_qty: '100', unit: 'ขวด' }
			]);

			const lotInputMap = {
				'stock_ledger:01J8LOT002': '50',
				'stock_ledger:01J8LOT001': '0',
				'stock_ledger:01J8LOT003': ''
			};

			const plans = buildApprovalPlan(request, lotInputMap, sampleLots);
			const allocations = buildApprovalAllocations(plans, sampleLots);

			expect(allocations).toHaveLength(1);
			expect(allocations[0]).toEqual({
				item_id: 'item_blanket',
				lot_ref: 'stock_ledger:01J8LOT002',
				qty: '50',
				lot: {
					lot_no: 'LOT-2026-B',
					expiry: '2027-05-01',
					storage_zone: 'Zone 2'
				}
			});
		});
	});
});
