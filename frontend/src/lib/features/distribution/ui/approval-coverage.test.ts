import { describe, expect, it } from 'vitest';
import { deriveApprovalCoverage } from './approval-coverage';
import type { DistributionRequest } from '../domain/distribution';

const makeRequest = (
	items: Array<{ item_id: string; requested_qty: string | number; unit?: string }>
) =>
	({
		items: items.map((it) => ({
			item_id: it.item_id,
			requested_qty: String(it.requested_qty),
			unit: it.unit ?? 'kg',
			distribution_type_snapshot: 'consumable' as const,
			target_qty_snapshot: String(it.requested_qty)
		}))
	}) as Pick<DistributionRequest, 'items'>;

describe('Approval Coverage Derivation', () => {
	// CASE 1 FULL
	it('CASE 1 FULL: detects full approval when requested 50 and allocated 50', () => {
		const request = makeRequest([{ item_id: 'item:rice', requested_qty: '50' }]);
		const allocations = [{ item_id: 'item:rice', qty: '50', lot_ref: 'stock_ledger:1' }];

		const result = deriveApprovalCoverage(request, allocations);

		expect(result.kind).toBe('full');
		expect(result.isFull).toBe(true);
		expect(result.isPartial).toBe(false);
		expect(result.totalRequestedQty).toBe('50');
		expect(result.totalAllocatedQty).toBe('50');
		expect(result.totalUnallocatedQty).toBe('0');
		expect(result.ctaLabel).toBe('ยืนยันอนุมัติครบจำนวน');
		expect(result.badgeLabel).toBe('จัดสรรครบจำนวน');
		expect(result.toastMessage).toBe('อนุมัติและจัดสรรครบตามจำนวนเรียบร้อยแล้ว');

		expect(result.items[0]).toEqual({
			itemId: 'item:rice',
			unit: 'kg',
			requestedQty: '50',
			allocatedQty: '50',
			unallocatedQty: '0',
			coverage: 'full',
			itemIndex: 0
		});
	});

	// CASE 2 PARTIAL
	it('CASE 2 PARTIAL: detects partial approval when requested 50 and allocated 5', () => {
		const request = makeRequest([{ item_id: 'item:rice', requested_qty: '50' }]);
		const allocations = [{ item_id: 'item:rice', qty: '5', lot_ref: 'stock_ledger:1' }];

		const result = deriveApprovalCoverage(request, allocations);

		expect(result.kind).toBe('partial');
		expect(result.isFull).toBe(false);
		expect(result.isPartial).toBe(true);
		expect(result.totalRequestedQty).toBe('50');
		expect(result.totalAllocatedQty).toBe('5');
		expect(result.totalUnallocatedQty).toBe('45');
		expect(result.ctaLabel).toBe('ยืนยันอนุมัติบางส่วน');
		expect(result.badgeLabel).toBe('จัดสรรบางส่วน');
		expect(result.toastMessage).toBe('อนุมัติการจัดสรรบางส่วนเรียบร้อยแล้ว');

		expect(result.items[0]).toEqual({
			itemId: 'item:rice',
			unit: 'kg',
			requestedQty: '50',
			allocatedQty: '5',
			unallocatedQty: '45',
			coverage: 'partial',
			itemIndex: 0
		});
	});

	// CASE 3 MULTI ITEM
	it('CASE 3 MULTI ITEM: overall partial when Item A is full (50/50) and Item B is partial (5/20)', () => {
		const request = makeRequest([
			{ item_id: 'item:rice', requested_qty: '50' },
			{ item_id: 'item:canned_fish', requested_qty: '20' }
		]);
		const allocations = [
			{ item_id: 'item:rice', qty: '50', lot_ref: 'stock_ledger:1' },
			{ item_id: 'item:canned_fish', qty: '5', lot_ref: 'stock_ledger:2' }
		];

		const result = deriveApprovalCoverage(request, allocations);

		expect(result.kind).toBe('partial');
		expect(result.isFull).toBe(false);
		expect(result.isPartial).toBe(true);
		expect(result.totalRequestedQty).toBe('70');
		expect(result.totalAllocatedQty).toBe('55');
		expect(result.totalUnallocatedQty).toBe('15');
		expect(result.items[0].coverage).toBe('full');
		expect(result.items[1].coverage).toBe('partial');
	});

	// CASE 4 ZERO ON ONE ITEM
	it('CASE 4 ZERO ON ONE ITEM: overall partial when Item A is full (50/50) and Item B has 0 allocated', () => {
		const request = makeRequest([
			{ item_id: 'item:rice', requested_qty: '50' },
			{ item_id: 'item:water', requested_qty: '20' }
		]);
		const allocations = [{ item_id: 'item:rice', qty: '50', lot_ref: 'stock_ledger:1' }];

		const result = deriveApprovalCoverage(request, allocations);

		expect(result.kind).toBe('partial');
		expect(result.isFull).toBe(false);
		expect(result.isPartial).toBe(true);
		expect(result.totalRequestedQty).toBe('70');
		expect(result.totalAllocatedQty).toBe('50');
		expect(result.totalUnallocatedQty).toBe('20');
		expect(result.items[0].coverage).toBe('full');
		expect(result.items[1].coverage).toBe('none');
		expect(result.items[1].unallocatedQty).toBe('20');
	});

	// CASE 5 MULTI LOT
	it('CASE 5 MULTI LOT: sums multiple lot allocations to full coverage (Lot A 20 + Lot B 30 = 50)', () => {
		const request = makeRequest([{ item_id: 'item:rice', requested_qty: '50' }]);
		const allocations = [
			{ item_id: 'item:rice', qty: '20', lot_ref: 'stock_ledger:lot_a' },
			{ item_id: 'item:rice', qty: '30', lot_ref: 'stock_ledger:lot_b' }
		];

		const result = deriveApprovalCoverage(request, allocations);

		expect(result.kind).toBe('full');
		expect(result.isFull).toBe(true);
		expect(result.totalAllocatedQty).toBe('50');
		expect(result.totalUnallocatedQty).toBe('0');
	});

	// CASE 6 PARTIAL MULTI LOT
	it('CASE 6 PARTIAL MULTI LOT: sums multiple lot allocations to partial coverage (Lot A 3 + Lot B 2 = 5 of 50)', () => {
		const request = makeRequest([{ item_id: 'item:rice', requested_qty: '50' }]);
		const allocations = [
			{ item_id: 'item:rice', qty: '3', lot_ref: 'stock_ledger:lot_a' },
			{ item_id: 'item:rice', qty: '2', lot_ref: 'stock_ledger:lot_b' }
		];

		const result = deriveApprovalCoverage(request, allocations);

		expect(result.kind).toBe('partial');
		expect(result.isPartial).toBe(true);
		expect(result.totalAllocatedQty).toBe('5');
		expect(result.totalUnallocatedQty).toBe('45');
	});

	// CASE 7 DUPLICATE REQUEST ITEM ROWS
	it('CASE 7 DUPLICATE REQUEST ITEM ROWS: preserves all rows when duplicate items exist in request', () => {
		const request = makeRequest([
			{ item_id: 'item:rice', requested_qty: '30' },
			{ item_id: 'item:rice', requested_qty: '20' }
		]);

		// Scenario 1: Partial overall (35 allocated total -> Row 0 gets 30, Row 1 gets 5)
		const partialAllocations = [{ item_id: 'item:rice', qty: '35', lot_ref: 'stock_ledger:1' }];
		const partialResult = deriveApprovalCoverage(request, partialAllocations);

		expect(partialResult.items).toHaveLength(2);
		expect(partialResult.items[0]).toEqual({
			itemId: 'item:rice',
			unit: 'kg',
			requestedQty: '30',
			allocatedQty: '30',
			unallocatedQty: '0',
			coverage: 'full',
			itemIndex: 0
		});
		expect(partialResult.items[1]).toEqual({
			itemId: 'item:rice',
			unit: 'kg',
			requestedQty: '20',
			allocatedQty: '5',
			unallocatedQty: '15',
			coverage: 'partial',
			itemIndex: 1
		});
		expect(partialResult.kind).toBe('partial');

		// Scenario 2: Full overall (50 allocated total -> Row 0 gets 30, Row 1 gets 20)
		const fullAllocations = [{ item_id: 'item:rice', qty: '50', lot_ref: 'stock_ledger:1' }];
		const fullResult = deriveApprovalCoverage(request, fullAllocations);

		expect(fullResult.items).toHaveLength(2);
		expect(fullResult.items[0].coverage).toBe('full');
		expect(fullResult.items[1].coverage).toBe('full');
		expect(fullResult.kind).toBe('full');
	});

	// CASE 8 DECIMAL QUANTITY (No JS float IEEE-754 precision issues)
	it('CASE 8 DECIMAL QUANTITY: correctly computes 0.1 + 0.2 === 0.3 without float precision bugs', () => {
		const request = makeRequest([{ item_id: 'item:medicine', requested_qty: '0.3', unit: 'l' }]);
		const allocations = [
			{ item_id: 'item:medicine', qty: '0.1', lot_ref: 'stock_ledger:lot_a' },
			{ item_id: 'item:medicine', qty: '0.2', lot_ref: 'stock_ledger:lot_b' }
		];

		const result = deriveApprovalCoverage(request, allocations);

		expect(result.kind).toBe('full');
		expect(result.isFull).toBe(true);
		expect(result.totalAllocatedQty).toBe('0.3');
		expect(result.totalUnallocatedQty).toBe('0');
		expect(result.items[0].unallocatedQty).toBe('0');
	});
});
