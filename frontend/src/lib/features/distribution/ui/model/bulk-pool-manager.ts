import type { AuthorContext } from '$lib/db/model';
import { ulid } from '$lib/db/ulid';
import type { ItemMaster } from '$lib/features/catalog';
import type { BulkReturnPool, BulkReturnPoolStatus } from '../../domain/food-supplies';
import { validateWholeItemInput } from '../../domain/food-supplies';
import type { CreateBulkPoolInput } from '../../application/food-supplies/return-workflow';
import { canReceivePhysicalStock } from '../../application/food-supplies/auth';
import { isAnyFoodCategory } from './catalog-eligibility';

export type BulkPoolStatusFilter = 'ALL' | BulkReturnPoolStatus;

export interface BulkPoolCatalogItem {
	_id: string;
	name: string;
	sku?: string;
}

export interface BulkPoolAccounting {
	totalReceived: string;
	claimed: string;
	remaining: string;
	claimCount: number;
}

export const BULK_POOL_STATUS_FILTERS: readonly BulkPoolStatusFilter[] = [
	'ALL',
	'ACTIVE',
	'EXHAUSTED',
	'CLOSED'
] as const;

export const BULK_POOL_STATUS_LABELS: Record<BulkPoolStatusFilter, string> = {
	ALL: 'ทั้งหมด',
	ACTIVE: 'ใช้งานอยู่',
	EXHAUSTED: 'โควตาหมด',
	CLOSED: 'ปิดแล้ว'
};

export function getBulkPoolStatusLabel(status: BulkReturnPoolStatus): string {
	return BULK_POOL_STATUS_LABELS[status];
}

export function resolveBulkPoolItemLabel(
	itemId: string,
	items: readonly BulkPoolCatalogItem[]
): BulkPoolCatalogItem {
	const item = items.find((candidate) => candidate._id === itemId);
	if (item) return item;

	return {
		_id: itemId,
		name: itemId.replace(/^item_master:|^item:/, '')
	};
}

export function filterBulkReturnPools(
	pools: readonly BulkReturnPool[],
	statusFilter: BulkPoolStatusFilter,
	search: string,
	items: readonly BulkPoolCatalogItem[]
): BulkReturnPool[] {
	const normalizedSearch = search.trim().toLocaleLowerCase();

	return pools.filter((pool) => {
		if (statusFilter !== 'ALL' && pool.status !== statusFilter) return false;
		if (!normalizedSearch) return true;

		const item = resolveBulkPoolItemLabel(pool.item_id, items);
		return [pool.item_id, item.name, item.sku]
			.filter((value): value is string => Boolean(value))
			.some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
	});
}

export function getBulkPoolAccounting(pool: BulkReturnPool): BulkPoolAccounting {
	return {
		totalReceived: pool.total_received_qty,
		claimed: pool.claimed_qty,
		remaining: pool.unclaimed_quota,
		claimCount: pool.claim_ids.length
	};
}

export type BulkPoolManagerViewState = 'loading' | 'error' | 'empty' | 'search_empty' | 'ready';

export function getBulkPoolManagerViewState(
	isLoading: boolean,
	isError: boolean,
	totalPoolCount: number,
	visiblePoolCount: number
): BulkPoolManagerViewState {
	if (isLoading) return 'loading';
	if (isError) return 'error';
	if (totalPoolCount === 0) return 'empty';
	if (visiblePoolCount === 0) return 'search_empty';
	return 'ready';
}

/**
 * Checks if the actor is authorized to open/create bulk return pools.
 * Aligned with canReceivePhysicalStock (warehouse_staff, supply_coordinator, shelter_manager, system_admin).
 */
export function canCreateBulkReturnPool(ctx: AuthorContext): boolean {
	return canReceivePhysicalStock(ctx);
}

/**
 * Evaluates whether an item is eligible for opening a bulk return pool.
 * Return pools are for relief supplies / equipment, excluding deactivated items and food consumables.
 */
export function isEligibleBulkPoolItem(
	item: Pick<ItemMaster, 'deactivated' | 'category' | 'type_class' | 'returnable'>
): boolean {
	if (item.deactivated) return false;
	if (isAnyFoodCategory(item.category)) return false;
	return true;
}

export interface CreateBulkPoolFormValidation {
	isValid: boolean;
	normalizedQty?: string;
	error?: string;
}

/**
 * Pure validator for Create Bulk Pool form inputs.
 * Requires a positive whole physical-unit count.
 */
export function validateCreateBulkPoolForm(
	itemId: string,
	rawQty: string
): CreateBulkPoolFormValidation {
	const trimmedItem = itemId.trim();
	if (!trimmedItem) {
		return { isValid: false, error: 'กรุณาเลือกรายการสินค้า' };
	}

	const trimmedQty = rawQty.trim();
	if (!trimmedQty) {
		return { isValid: false, error: 'กรุณาระบุจำนวนที่รับคืน' };
	}
	const result = validateWholeItemInput(trimmedQty);
	if (!result.isValid || !result.value) {
		return { isValid: false, error: result.error ?? 'จำนวนต้องเป็นจำนวนเต็มที่ถูกต้อง' };
	}
	return { isValid: true, normalizedQty: result.value };
}

/**
 * Builds the canonical CreateBulkPoolInput payload.
 * Strictly caller-owned fields only; excludes server/domain-owned fields.
 */
export function buildCreateBulkPoolInput(params: {
	operationUlid: string;
	itemId: string;
	totalReceivedQty: string;
	notes?: string;
}): CreateBulkPoolInput {
	const trimmedNotes = params.notes?.trim();
	return {
		operationUlid: params.operationUlid,
		item_id: params.itemId,
		total_received_qty: params.totalReceivedQty,
		...(trimmedNotes ? { notes: trimmedNotes } : {})
	};
}

export interface BulkPoolCreateSessionState {
	operationUlid: string;
	itemId: string;
	receivedQty: string;
	notes: string;
}

export function createBulkPoolSession(): BulkPoolCreateSessionState {
	return {
		operationUlid: ulid(),
		itemId: '',
		receivedQty: '',
		notes: ''
	};
}

export function preserveSessionOnFailure(
	state: BulkPoolCreateSessionState
): BulkPoolCreateSessionState {
	return { ...state };
}

export function resetSessionOnSuccess(): BulkPoolCreateSessionState {
	return createBulkPoolSession();
}
