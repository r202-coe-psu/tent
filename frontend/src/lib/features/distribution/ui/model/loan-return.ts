import { addQty, qtyGt, qtyLte, qtyStrPositiveSchema, subQty } from '$lib/utils/qty';
import type { DistributionLog, ReturnCondition } from '../../domain/food-supplies';

/**
 * Pure predicate identifying whether a distribution log is currently an open, returnable loan.
 * Strictly checks that the log is returnable and in active or partially_returned status.
 */
export function isLoanReturnCandidate(log: DistributionLog): boolean {
	if (!log.is_returnable) return false;
	return log.status === 'active' || log.status === 'partially_returned';
}

/**
 * Pure predicate identifying whether a distribution log was already cleared through bulk dropoff.
 * B1 invariant: bulk-cleared loans must NEVER be physically restocked at the counter.
 */
export function isBulkClearedLoan(log: DistributionLog): boolean {
	return Boolean(
		log.status === 'returned' &&
		(log.clear_reason === 'bulk_dropoff' || log.bulk_pool_id !== undefined)
	);
}

/**
 * Calculates remaining loan quantity safely using Decimal string arithmetic.
 * remaining = issued_qty - cumulative_qty_returned
 */
export function calculateLoanRemainingQty(
	log: Pick<DistributionLog, 'qty' | 'qty_returned'>
): string {
	const previouslyReturned = log.qty_returned ?? '0';
	const remaining = subQty(log.qty, previouslyReturned);
	return qtyGt(remaining, '0') ? remaining : '0';
}

/**
 * Calculates new target cumulative returned quantity given the previous cumulative returned
 * and the additional quantity being returned in this specific physical interaction.
 * target_cumulative = previously_returned + returning_now
 */
export function calculateNewCumulativeReturned(
	previousReturned: string | undefined,
	returningNow: string
): string {
	const prev = previousReturned ?? '0';
	const delta = returningNow.trim() || '0';
	return addQty(prev, delta);
}

export interface ReturnQtyValidationResult {
	isValid: boolean;
	error?: string;
}

/**
 * Validates the quantity entered by an operator for physical counter return.
 * Uses canonical Decimal schema parsing (qtyStrPositiveSchema) rather than parseFloat
 * to preserve exact fractional precision (≤4 decimals) and strictly reject non-numeric syntax.
 * - Must be non-empty
 * - Must be a valid positive quantity (> 0, ≤4 decimals)
 * - Must not exceed currently known remaining balance
 */
export function validateCounterReturnQuantity(
	returningNow: string,
	remaining: string
): ReturnQtyValidationResult {
	const trimmed = returningNow.trim();
	if (!trimmed) {
		return { isValid: false, error: 'กรุณาระบุจำนวนที่ต้องการคืน' };
	}

	const parsed = qtyStrPositiveSchema.safeParse(trimmed);
	if (!parsed.success) {
		return {
			isValid: false,
			error: 'จำนวนที่คืนต้องมากกว่า 0 และเป็นตัวเลขทศนิยมไม่เกิน 4 ตำแหน่ง'
		};
	}

	if (!qtyLte(parsed.data, remaining)) {
		return {
			isValid: false,
			error: `จำนวนที่คืนครั้งนี้ (${trimmed}) เกินจำนวนคงค้างที่ต้องส่งคืน (${remaining})`
		};
	}

	return { isValid: true };
}

export interface LoanStatusBadgeInfo {
	label: string;
	badgeClass: string;
}

/**
 * Returns human-readable Thai label and design-system styling for loan logs.
 */
export function getLoanStatusBadge(log: DistributionLog): LoanStatusBadgeInfo {
	if (log.status === 'active') {
		return {
			label: 'กำลังยืม',
			badgeClass: 'border-amber-200 bg-amber-50 text-amber-900'
		};
	}
	if (log.status === 'partially_returned') {
		return {
			label: 'คืนบางส่วน',
			badgeClass: 'border-sky-200 bg-sky-50 text-sky-900'
		};
	}
	if (log.status === 'returned') {
		if (log.clear_reason === 'bulk_dropoff' || log.bulk_pool_id) {
			return {
				label: 'เคลียร์ผ่านจุดรวบรวม (Bulk)',
				badgeClass: 'border-purple-200 bg-purple-50 text-purple-900'
			};
		}
		return {
			label: 'คืนครบแล้ว',
			badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-900'
		};
	}
	if (log.status === 'lost') {
		return {
			label: 'สูญหาย (ตัดจำหน่าย)',
			badgeClass: 'border-red-200 bg-red-50 text-red-900'
		};
	}
	if (log.status === 'waived') {
		return {
			label: 'ยกเว้นการคืน',
			badgeClass: 'border-slate-200 bg-slate-50 text-slate-700'
		};
	}
	if (log.status === 'voided') {
		return {
			label: 'ยกเลิกรายการ',
			badgeClass: 'border-slate-300 bg-slate-100 text-slate-500'
		};
	}
	return {
		label: log.status,
		badgeClass: 'border-slate-200 bg-slate-50 text-slate-700'
	};
}

export const RETURN_CONDITION_OPTIONS: {
	value: ReturnCondition;
	label: string;
	description: string;
}[] = [
	{
		value: 'READY',
		label: 'สภาพดี / พร้อมใช้งาน (Ready)',
		description: 'พัสดุอยู่ในสภาพสมบูรณ์ พร้อมนำไปแจกจ่ายหรือให้ยืมต่อ'
	},
	{
		value: 'MAINTENANCE',
		label: 'ต้องซ่อมบำรุง / ทำความสะอาด (Maintenance)',
		description: 'พัสดุต้องทำความสะอาดหรือซ่อมแซมก่อนนำกลับมาใช้งาน'
	},
	{
		value: 'BROKEN',
		label: 'ชำรุดเสียหาย (Broken)',
		description: 'พัสดุชำรุด ใช้งานไม่ได้ตามปกติ'
	}
];
