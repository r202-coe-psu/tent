import { addQty, persistQty, qtyGt, qtyGte, qtyIsZero, subQty } from '$lib/utils/qty';
import type {
	DistributionBatch,
	DistributionRequest,
	DistributionRequestItem
} from '../domain/distribution';
import { calculateApprovalCoverage } from '../domain/distribution';
import type { DistributionAllocationInput } from '../data/distribution.repository';
import type { ItemAllocationPlan } from './approval-allocation-form';

export type CoverageKind = 'full' | 'partial' | 'none';

export interface ItemCoverageDetail {
	itemId: string;
	unit: string;
	requestedQty: string;
	allocatedQty: string;
	unallocatedQty: string;
	coverage: CoverageKind;
	itemIndex: number;
}

export interface ApprovalCoverageSummary {
	kind: CoverageKind;
	isFull: boolean;
	isPartial: boolean;
	totalRequestedItemsCount: number;
	allocatedItemsCount: number;
	items: ItemCoverageDetail[];
	totalRequestedQty: string;
	totalAllocatedQty: string;
	totalUnallocatedQty: string;
	ctaLabel: string;
	badgeLabel: string;
	toastMessage: string;
}

type AllocationSource =
	| readonly DistributionAllocationInput[]
	| readonly { item_id: string; qty: string | number; lot_ref?: string }[]
	| DistributionBatch
	| readonly ItemAllocationPlan[];

function isPlanArray(source: unknown): source is readonly ItemAllocationPlan[] {
	if (!Array.isArray(source) || source.length === 0) return false;
	const first = source[0];
	return (
		typeof first === 'object' && first !== null && 'row_index' in first && 'lotEntries' in first
	);
}

/**
 * Pure presentation helper to derive coverage statistics for a distribution request
 * against an allocation plan or persisted batch.
 *
 * Enforces authoritative Decimal quantity arithmetic with zero floating-point math.
 */
export function deriveApprovalCoverage(
	request: Pick<DistributionRequest, 'items'> | null | undefined,
	allocationsOrBatchOrPlans: AllocationSource | null | undefined
): ApprovalCoverageSummary {
	const requestItems: readonly DistributionRequestItem[] = request?.items ?? [];

	if (isPlanArray(allocationsOrBatchOrPlans)) {
		const plans = allocationsOrBatchOrPlans;
		let totalRequested = '0';
		let totalAllocated = '0';
		let totalUnallocated = '0';
		let positiveAllocations = 0;

		const items: ItemCoverageDetail[] = plans.map((plan, index) => {
			const reqQty = persistQty(plan.requested_qty);
			const allocQty = persistQty(plan.allocated_qty);
			const unallocQty = qtyGt(reqQty, allocQty) ? subQty(reqQty, allocQty) : '0';

			let coverage: CoverageKind = 'none';
			if (qtyGte(allocQty, reqQty) && !qtyIsZero(reqQty)) {
				coverage = 'full';
			} else if (qtyGt(allocQty, 0)) {
				coverage = 'partial';
			}

			if (qtyGt(allocQty, 0)) {
				positiveAllocations++;
			}

			totalRequested = addQty(totalRequested, reqQty);
			totalAllocated = addQty(totalAllocated, allocQty);
			totalUnallocated = addQty(totalUnallocated, unallocQty);

			return {
				itemId: plan.item_id,
				unit: plan.unit,
				requestedQty: reqQty,
				allocatedQty: allocQty,
				unallocatedQty: unallocQty,
				coverage,
				itemIndex: plan.row_index ?? index
			};
		});

		const hasPositive = qtyGt(totalAllocated, 0);
		const allFull = items.length > 0 && items.every((it) => it.coverage === 'full');
		const kind: CoverageKind = !hasPositive ? 'none' : allFull ? 'full' : 'partial';

		return {
			kind,
			isFull: kind === 'full',
			isPartial: kind === 'partial',
			totalRequestedItemsCount: items.length,
			allocatedItemsCount: positiveAllocations,
			items,
			totalRequestedQty: totalRequested,
			totalAllocatedQty: totalAllocated,
			totalUnallocatedQty: totalUnallocated,
			ctaLabel: kind === 'full' ? 'ยืนยันอนุมัติครบจำนวน' : 'ยืนยันอนุมัติบางส่วน',
			badgeLabel: kind === 'full' ? 'จัดสรรครบจำนวน' : 'จัดสรรบางส่วน',
			toastMessage:
				kind === 'full'
					? 'อนุมัติและจัดสรรครบตามจำนวนเรียบร้อยแล้ว'
					: 'อนุมัติการจัดสรรบางส่วนเรียบร้อยแล้ว'
		};
	}

	// Raw allocations array or DistributionBatch
	const rawAllocations: readonly { item_id: string; qty: string | number }[] =
		!allocationsOrBatchOrPlans
			? []
			: 'allocations' in allocationsOrBatchOrPlans
				? (allocationsOrBatchOrPlans.allocations as readonly {
						item_id: string;
						qty: string | number;
					}[])
				: (allocationsOrBatchOrPlans as readonly { item_id: string; qty: string | number }[]);

	// Group allocations by item_id
	const allocTotalsByItem = new Map<string, string>();
	for (const alloc of rawAllocations) {
		const current = allocTotalsByItem.get(alloc.item_id) ?? '0';
		allocTotalsByItem.set(alloc.item_id, addQty(current, alloc.qty));
	}

	// For duplicate request rows of the same item_id, track remaining pool to allocate FIFO
	const remainingPoolByItem = new Map<string, string>(allocTotalsByItem);

	let totalRequested = '0';
	let totalAllocated = '0';
	let totalUnallocated = '0';
	let positiveAllocations = 0;

	const items: ItemCoverageDetail[] = requestItems.map((reqItem, index) => {
		const reqQty = persistQty(reqItem.requested_qty);
		const pool = remainingPoolByItem.get(reqItem.item_id) ?? '0';

		let allocQty = '0';
		if (qtyGt(pool, 0)) {
			if (qtyGte(pool, reqQty)) {
				allocQty = reqQty;
				remainingPoolByItem.set(reqItem.item_id, subQty(pool, reqQty));
			} else {
				allocQty = pool;
				remainingPoolByItem.set(reqItem.item_id, '0');
			}
		}

		const unallocQty = qtyGt(reqQty, allocQty) ? subQty(reqQty, allocQty) : '0';

		let coverage: CoverageKind = 'none';
		if (qtyGte(allocQty, reqQty) && !qtyIsZero(reqQty)) {
			coverage = 'full';
		} else if (qtyGt(allocQty, 0)) {
			coverage = 'partial';
		}

		if (qtyGt(allocQty, 0)) {
			positiveAllocations++;
		}

		totalRequested = addQty(totalRequested, reqQty);
		totalAllocated = addQty(totalAllocated, allocQty);
		totalUnallocated = addQty(totalUnallocated, unallocQty);

		return {
			itemId: reqItem.item_id,
			unit: reqItem.unit,
			requestedQty: reqQty,
			allocatedQty: allocQty,
			unallocatedQty: unallocQty,
			coverage,
			itemIndex: index
		};
	});

	const hasPositive = qtyGt(totalAllocated, 0);
	const kind: CoverageKind = !hasPositive
		? 'none'
		: calculateApprovalCoverage(requestItems, rawAllocations);

	return {
		kind,
		isFull: kind === 'full',
		isPartial: kind === 'partial',
		totalRequestedItemsCount: items.length,
		allocatedItemsCount: positiveAllocations,
		items,
		totalRequestedQty: totalRequested,
		totalAllocatedQty: totalAllocated,
		totalUnallocatedQty: totalUnallocated,
		ctaLabel: kind === 'full' ? 'ยืนยันอนุมัติครบจำนวน' : 'ยืนยันอนุมัติบางส่วน',
		badgeLabel: kind === 'full' ? 'จัดสรรครบจำนวน' : 'จัดสรรบางส่วน',
		toastMessage:
			kind === 'full'
				? 'อนุมัติและจัดสรรครบตามจำนวนเรียบร้อยแล้ว'
				: 'อนุมัติการจัดสรรบางส่วนเรียบร้อยแล้ว'
	};
}
