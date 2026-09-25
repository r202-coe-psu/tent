import { describe, expect, it } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import { isUlid } from '$lib/db/ulid';
import type { BulkReturnPool } from '../../domain/food-supplies';
import {
	buildCreateBulkPoolInput,
	canCreateBulkReturnPool,
	createBulkPoolSession,
	filterBulkReturnPools,
	getBulkPoolAccounting,
	getBulkPoolManagerViewState,
	getBulkPoolStatusLabel,
	isEligibleBulkPoolItem,
	preserveSessionOnFailure,
	resetSessionOnSuccess,
	resolveBulkPoolItemLabel,
	validateCreateBulkPoolForm
} from './bulk-pool-manager';

const makePool = (
	id: string,
	status: BulkReturnPool['status'],
	overrides: Partial<BulkReturnPool> = {}
): BulkReturnPool => ({
	_id: `bulk_return_pool:${id}`,
	type: 'bulk_return_pool',
	schema_v: 2,
	shelter_code: 'SH001',
	created_at: '2026-09-24T08:00:00.000Z',
	updated_at: '2026-09-24T08:00:00.000Z',
	created_by: 'warehouse_user',
	item_id: 'item:fan',
	stock_ledger_id: `stock_ledger:${id}`,
	total_received_qty: '10.5',
	claimed_qty: status === 'ACTIVE' ? '2.5' : '10.5',
	unclaimed_quota: status === 'ACTIVE' ? '8' : '0',
	claim_ids: status === 'ACTIVE' ? [`bulk_return_claim:${id}`] : [],
	status,
	...(status === 'CLOSED'
		? { closed_at: '2026-09-24T10:00:00.000Z', closed_by: 'manager_user' }
		: {}),
	...overrides
});

const pools = [
	makePool('active', 'ACTIVE'),
	makePool('exhausted', 'EXHAUSTED', { item_id: 'item:rice' }),
	makePool('closed', 'CLOSED', { item_id: 'item_master:blanket' })
];

const items = [
	{ _id: 'item:fan', name: 'พัดลม', sku: 'FAN-001' },
	{ _id: 'item:rice', name: 'ข้าวสาร', sku: 'RICE-001' },
	{ _id: 'item_master:blanket', name: 'ผ้าห่ม', sku: 'BLK-001' }
];

describe('Bulk Pool Manager model (Slice 5.5E-1 Read-Only)', () => {
	it('filters all canonical pool statuses and keeps all-status view complete', () => {
		expect(filterBulkReturnPools(pools, 'ALL', '', items)).toHaveLength(3);
		expect(filterBulkReturnPools(pools, 'ACTIVE', '', items).map((pool) => pool.status)).toEqual([
			'ACTIVE'
		]);
		expect(filterBulkReturnPools(pools, 'EXHAUSTED', '', items).map((pool) => pool.status)).toEqual(
			['EXHAUSTED']
		);
		expect(filterBulkReturnPools(pools, 'CLOSED', '', items).map((pool) => pool.status)).toEqual([
			'CLOSED'
		]);
	});

	it('searches resolved item names, SKUs, and fallback IDs', () => {
		expect(filterBulkReturnPools(pools, 'ALL', 'ข้าว', items)).toEqual([pools[1]]);
		expect(filterBulkReturnPools(pools, 'ALL', 'blk-001', items)).toEqual([pools[2]]);
		expect(filterBulkReturnPools(pools, 'ALL', 'item:fan', items)).toEqual([pools[0]]);
		expect(resolveBulkPoolItemLabel('item:unknown', items).name).toBe('unknown');
	});

	it('returns authoritative quantity strings and claim count without floating-point arithmetic', () => {
		expect(getBulkPoolAccounting(pools[0])).toEqual({
			totalReceived: '10.5',
			claimed: '2.5',
			remaining: '8',
			claimCount: 1
		});
	});

	it('provides textual status labels', () => {
		expect(getBulkPoolStatusLabel('ACTIVE')).toBe('ใช้งานอยู่');
		expect(getBulkPoolStatusLabel('EXHAUSTED')).toBe('โควตาหมด');
		expect(getBulkPoolStatusLabel('CLOSED')).toBe('ปิดแล้ว');
	});

	it('distinguishes loading, repository empty, and empty search results', () => {
		expect(getBulkPoolManagerViewState(true, false, 0, 0)).toBe('loading');
		expect(getBulkPoolManagerViewState(false, true, 0, 0)).toBe('error');
		expect(getBulkPoolManagerViewState(false, false, 0, 0)).toBe('empty');
		expect(getBulkPoolManagerViewState(false, false, 3, 0)).toBe('search_empty');
		expect(getBulkPoolManagerViewState(false, false, 3, 3)).toBe('ready');
	});
});

describe('Bulk Pool Intake & Create Dialog (Slice 5.5E-2)', () => {
	const makeCtx = (capabilities: string[], shelterCode = 'SH001'): AuthorContext => ({
		shelterCode,
		createdBy: 'wh_user',
		roles: capabilities.includes('system_admin')
			? ['system_admin']
			: [`shelter:${shelterCode}`, ...capabilities]
	});

	describe('A. Authorization visibility (canCreateBulkReturnPool)', () => {
		it('permits warehouse staff to create pool', () => {
			const ctx = makeCtx(['warehouse_staff']);
			expect(canCreateBulkReturnPool(ctx)).toBe(true);
		});

		it('hides/rejects registration staff from creating pool', () => {
			const ctx = makeCtx(['registration_staff']);
			expect(canCreateBulkReturnPool(ctx)).toBe(false);
		});

		it('permits supply coordinator to create pool', () => {
			const ctx = makeCtx(['supply_coordinator']);
			expect(canCreateBulkReturnPool(ctx)).toBe(true);
		});

		it('permits shelter manager to create pool', () => {
			const ctx = makeCtx(['shelter_manager']);
			expect(canCreateBulkReturnPool(ctx)).toBe(true);
		});

		it('permits system admin to create pool across shelters', () => {
			const ctx = makeCtx(['system_admin']);
			expect(canCreateBulkReturnPool(ctx)).toBe(true);
		});
	});

	describe('B. Quantity validation (validateCreateBulkPoolForm)', () => {
		it('rejects empty quantity', () => {
			const res = validateCreateBulkPoolForm('item:fan', '');
			expect(res.isValid).toBe(false);
			expect(res.error).toBe('กรุณาระบุจำนวนที่รับคืน');
		});

		it('rejects whitespace-only quantity', () => {
			const res = validateCreateBulkPoolForm('item:fan', '   ');
			expect(res.isValid).toBe(false);
			expect(res.error).toBe('กรุณาระบุจำนวนที่รับคืน');
		});

		it('rejects zero quantity', () => {
			const res = validateCreateBulkPoolForm('item:fan', '0');
			expect(res.isValid).toBe(false);
			expect(res.error).toBe('จำนวนต้องมากกว่า 0');
		});

		it('rejects negative quantity', () => {
			const res = validateCreateBulkPoolForm('item:fan', '-5');
			expect(res.isValid).toBe(false);
			expect(res.error).toBe('จำนวนต้องมากกว่า 0');
		});

		it('rejects non-numeric quantity', () => {
			const res = validateCreateBulkPoolForm('item:fan', 'abc');
			expect(res.isValid).toBe(false);
			expect(res.error).toBe('จำนวนต้องเป็นตัวเลขที่ถูกต้อง');
		});

		it('accepts and normalizes valid positive integer quantity', () => {
			const res = validateCreateBulkPoolForm('item:fan', '10');
			expect(res.isValid).toBe(true);
			expect(res.normalizedQty).toBe('10');
		});

		it('accepts and normalizes valid positive decimal quantity with whole-item ceiling', () => {
			const res = validateCreateBulkPoolForm('item:fan', '25.5');
			expect(res.isValid).toBe(true);
			expect(res.normalizedQty).toBe('26');
			expect(res.wasNormalized).toBe(true);
		});
	});

	describe('C. Item eligibility (isEligibleBulkPoolItem)', () => {
		it('rejects missing/empty item in form validation', () => {
			const res = validateCreateBulkPoolForm('', '10');
			expect(res.isValid).toBe(false);
			expect(res.error).toBe('กรุณาเลือกรายการสินค้า');
		});

		it('accepts eligible returnable relief supplies', () => {
			const item = {
				deactivated: false,
				category: 'item_category:supplies',
				type_class: 'DURABLE' as const,
				returnable: true
			};
			expect(isEligibleBulkPoolItem(item)).toBe(true);
		});

		it('rejects deactivated items', () => {
			const item = {
				deactivated: true,
				category: 'item_category:supplies',
				type_class: 'DURABLE' as const,
				returnable: true
			};
			expect(isEligibleBulkPoolItem(item)).toBe(false);
		});

		it('rejects ready meal food items from bulk return pools', () => {
			const item = {
				deactivated: false,
				category: 'item_category:ready_meal',
				type_class: 'CONSUMABLE' as const,
				returnable: false
			};
			expect(isEligibleBulkPoolItem(item)).toBe(false);
		});

		it('rejects kitchen food items from bulk return pools', () => {
			const item = {
				deactivated: false,
				category: 'item_category:food',
				type_class: 'CONSUMABLE' as const,
				returnable: false
			};
			expect(isEligibleBulkPoolItem(item)).toBe(false);
		});
	});

	describe('D. Operation token lifecycle (operationUlid)', () => {
		it('generates a valid monotonic ULID once on session creation', () => {
			const session = createBulkPoolSession();
			expect(isUlid(session.operationUlid)).toBe(true);
		});

		it('retains the SAME operationUlid on submit failure/retry', () => {
			const session = createBulkPoolSession();
			session.itemId = 'item:fan';
			session.receivedQty = '10';
			session.notes = 'First attempt failed due to timeout';

			const preserved = preserveSessionOnFailure(session);
			expect(preserved.operationUlid).toBe(session.operationUlid);
			expect(preserved.itemId).toBe(session.itemId);
			expect(preserved.receivedQty).toBe(session.receivedQty);
			expect(preserved.notes).toBe(session.notes);
		});

		it('generates a NEW operationUlid when starting a new session after success', () => {
			const session1 = createBulkPoolSession();
			const session2 = resetSessionOnSuccess();

			expect(isUlid(session2.operationUlid)).toBe(true);
			expect(session2.operationUlid).not.toBe(session1.operationUlid);
			expect(session2.itemId).toBe('');
			expect(session2.receivedQty).toBe('');
			expect(session2.notes).toBe('');
		});
	});

	describe('E. Form preservation across failure', () => {
		it('preserves all operator inputs when a mutation error occurs', () => {
			const session: ReturnType<typeof createBulkPoolSession> = {
				operationUlid: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
				itemId: 'item:tent_light',
				receivedQty: '15',
				notes: 'Collected from Zone 2 exit'
			};

			const failedState = preserveSessionOnFailure(session);
			expect(failedState).toEqual(session);
		});
	});

	describe('F. Mutation payload construction (buildCreateBulkPoolInput)', () => {
		it('produces exact caller-owned fields and trims optional notes', () => {
			const payload = buildCreateBulkPoolInput({
				operationUlid: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
				itemId: 'item:fan',
				totalReceivedQty: '20',
				notes: '  Swept from zone A  '
			});

			expect(payload).toEqual({
				operationUlid: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
				item_id: 'item:fan',
				total_received_qty: '20',
				notes: 'Swept from zone A'
			});

			// Strictly asserts that ONLY caller-owned fields exist (no server-owned fields)
			expect(Object.keys(payload).sort()).toEqual(
				['item_id', 'notes', 'operationUlid', 'total_received_qty'].sort()
			);
		});

		it('omits notes when empty or undefined', () => {
			const payload = buildCreateBulkPoolInput({
				operationUlid: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
				itemId: 'item:fan',
				totalReceivedQty: '20',
				notes: '   '
			});

			expect(payload).toEqual({
				operationUlid: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
				item_id: 'item:fan',
				total_received_qty: '20'
			});

			expect(Object.keys(payload).sort()).toEqual(
				['item_id', 'operationUlid', 'total_received_qty'].sort()
			);
		});
	});
});
