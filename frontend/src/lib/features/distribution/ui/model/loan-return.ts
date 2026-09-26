import { addQty, qtyGt, qtyLte, subQty } from '$lib/utils/qty';
import {
	positiveWholeQtySchema,
	type DistributionLog,
	type ReturnCondition,
	type NonPhysicalClearReason,
	type BulkReturnPoolStatus
} from '../../domain/food-supplies';
import { getBulkPoolStatusLabel } from './bulk-pool-manager';

export type { NonPhysicalClearReason };

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
	normalizedQty?: string;
}

/**
 * Validates the quantity entered by an operator for physical counter return.
 * Requires countable whole-item input without rounding.
 * - Must be non-empty
 * - Must be a valid positive whole quantity
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

	const parsed = positiveWholeQtySchema.safeParse(trimmed);
	if (!parsed.success) {
		const error =
			/^-/.test(trimmed) || trimmed === '0'
				? 'จำนวนที่คืนต้องมากกว่า 0'
				: /\./.test(trimmed)
					? 'จำนวนที่คืนต้องเป็นจำนวนเต็ม เช่น 1, 2, 3'
					: 'จำนวนที่คืนต้องเป็นตัวเลขจำนวนเต็มที่ถูกต้อง';
		return {
			isValid: false,
			error: error
		};
	}

	const targetQty = parsed.data;

	if (!qtyLte(targetQty, remaining)) {
		return {
			isValid: false,
			error: `จำนวนที่คืนครั้งนี้ (${targetQty}) เกินจำนวนคงค้างที่ต้องส่งคืน (${remaining})`,
			normalizedQty: targetQty
		};
	}

	return {
		isValid: true,
		normalizedQty: targetQty
	};
}

export interface NonPhysicalClearValidationResult {
	isValid: boolean;
	error?: string;
}

/**
 * Canonical options for administrative non-physical loan write-offs (Slice 5.5C).
 * Strictly mirrors NonPhysicalClearInput ('lost' | 'waived') in return-workflow.ts.
 */
export const NON_PHYSICAL_CLEAR_REASON_OPTIONS: {
	value: NonPhysicalClearReason;
	label: string;
	description: string;
}[] = [
	{
		value: 'lost',
		label: 'สูญหาย',
		description: 'ผู้ประสบภัยทำพัสดุสูญหาย ไม่สามารถนำส่งคืนคลังได้'
	},
	{
		value: 'waived',
		label: 'ยกเว้นการคืน',
		description: 'เจ้าหน้าที่พิจารณาอนุมัติยกเว้นการคืนเป็นกรณีพิเศษ'
	}
];

/**
 * Validates operator input for non-physical loan clearance.
 * - Reason must be either 'lost' or 'waived'
 * - Notes are mandatory per workflow and VDU Rule 13 contract
 */
export function validateNonPhysicalClear(
	reason: string | null | undefined,
	notes: string
): NonPhysicalClearValidationResult {
	if (!reason || (reason !== 'lost' && reason !== 'waived')) {
		return { isValid: false, error: 'กรุณาเลือกเหตุผลในการตัดจำหน่ายรายการ' };
	}
	if (!notes || !notes.trim()) {
		return { isValid: false, error: 'กรุณาระบุหมายเหตุหรือเหตุผลประกอบการตัดจำหน่ายรายการ' };
	}
	return { isValid: true };
}

/**
 * Determines whether the loan return or clearance dialog form state should be re-initialized.
 * Only returns true when opening a new dialog session or switching to a different loan record.
 * Crucially returns false on mutation retry, preserving operator input and error feedback.
 */
export function shouldResetLoanDialog(
	lastInitializedLogId: string | null,
	isOpen: boolean,
	currentLogId: string | null | undefined
): boolean {
	if (!isOpen || !currentLogId) return false;
	return lastInitializedLogId !== currentLogId;
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
				label: 'เคลียร์ผ่านจุดรวบรวม',
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
		label: 'สภาพดี / พร้อมใช้งาน',
		description: 'พัสดุอยู่ในสภาพสมบูรณ์ พร้อมนำไปแจกจ่ายหรือให้ยืมต่อ'
	},
	{
		value: 'MAINTENANCE',
		label: 'ต้องซ่อมบำรุง / ทำความสะอาด',
		description: 'พัสดุต้องทำความสะอาดหรือซ่อมแซมก่อนนำกลับมาใช้งาน'
	},
	{
		value: 'BROKEN',
		label: 'ชำรุดเสียหาย',
		description: 'พัสดุชำรุด ใช้งานไม่ได้ตามปกติ'
	}
];

export interface BulkGateClearValidationResult {
	isValid: boolean;
	error?: string;
}

/**
 * Pure predicate identifying whether a BulkReturnPool is eligible to clear a given loan obligation (CR-134).
 * - Matching item_id
 * - Status must be ACTIVE
 * - unclaimed_quota > 0
 * - If requiredQty is specified, pool unclaimed_quota must be >= requiredQty
 */
export function isEligibleBulkPool(
	pool: { item_id: string; status: string; unclaimed_quota: string },
	itemId: string,
	requiredQty?: string
): boolean {
	if (pool.item_id !== itemId) return false;
	if (pool.status !== 'ACTIVE') return false;
	if (!qtyGt(pool.unclaimed_quota, '0')) return false;
	if (requiredQty && !qtyLte(requiredQty, pool.unclaimed_quota)) return false;
	return true;
}

/**
 * Validates operator input for CR-134 bulk gate clearance.
 * - Pool must be selected
 * - Pool must be ACTIVE
 * - Pool must have unclaimed_quota >= required loan outstanding balance
 */
export function validateBulkGateClear(
	selectedPool: { status: string; unclaimed_quota: string } | null | undefined,
	requiredQty: string
): BulkGateClearValidationResult {
	if (!selectedPool) {
		return { isValid: false, error: 'กรุณาเลือกจุดรวมคืน (Bulk Return Pool) ที่ต้องการเคลียร์' };
	}
	if (selectedPool.status !== 'ACTIVE') {
		const statusLabel =
			getBulkPoolStatusLabel(selectedPool.status as BulkReturnPoolStatus) ?? selectedPool.status;
		return {
			isValid: false,
			error: `จุดรวมคืนนี้ไม่อยู่ในสถานะใช้งานได้ (สถานะ: ${statusLabel})`
		};
	}
	if (!qtyGt(selectedPool.unclaimed_quota, '0')) {
		return { isValid: false, error: 'จุดรวมคืนนี้ไม่มีโควตาคงเหลือแล้ว' };
	}
	if (!qtyLte(requiredQty, selectedPool.unclaimed_quota)) {
		return {
			isValid: false,
			error: `โควตาคงเหลือของจุดรวมคืน (${selectedPool.unclaimed_quota}) ไม่เพียงพอกับยอดคงค้าง (${requiredQty})`
		};
	}
	return { isValid: true };
}

export interface BulkForwardRecoveryInput {
	pool: { item_id?: string; status: string } | null | undefined;
	expectedItemId?: string;
	isLoading?: boolean;
}

/**
 * Validates forward recovery for a bulk operation.
 * Permits EXHAUSTED pools if this operation is recovering its existing quota claim.
 */
export function validateBulkForwardRecovery(
	inputOrPool: BulkForwardRecoveryInput | { item_id?: string; status: string } | null | undefined,
	maybeExpectedItemId?: string
): BulkGateClearValidationResult {
	const isObjectConfig =
		inputOrPool !== null && typeof inputOrPool === 'object' && 'pool' in inputOrPool;

	const pool = isObjectConfig
		? (inputOrPool as BulkForwardRecoveryInput).pool
		: (inputOrPool as { item_id?: string; status: string } | null | undefined);

	const expectedItemId = isObjectConfig
		? (inputOrPool as BulkForwardRecoveryInput).expectedItemId
		: maybeExpectedItemId;

	const isLoading = isObjectConfig
		? Boolean((inputOrPool as BulkForwardRecoveryInput).isLoading)
		: false;

	if (isLoading) {
		return { isValid: false, error: 'กำลังโหลดข้อมูลจุดรวมคืนสำหรับกู้คืนรายการ' };
	}
	if (!pool) {
		return { isValid: false, error: 'ไม่พบข้อมูลจุดรวมคืนสำหรับกู้คืนรายการ' };
	}
	if (pool.status === 'CLOSED') {
		return { isValid: false, error: 'จุดรวมคืนนี้ถูกปิดแล้ว ไม่สามารถกู้คืนรายการได้' };
	}
	if (expectedItemId && pool.item_id && pool.item_id !== expectedItemId) {
		return {
			isValid: false,
			error: `จุดรวมคืนที่กู้คืน (${pool.item_id}) ไม่ตรงกับสินค้าในรายการยืม (${expectedItemId})`
		};
	}
	return { isValid: true };
}

export interface CounterRecoveryHydrationInput {
	open: boolean;
	logId: string | null | undefined;
	reservation?: {
		mode: string;
		operation_id: string;
		qty_returned?: string;
		return_condition?: ReturnCondition;
		notes?: string;
	} | null;
	hydratedOperationId: string | null;
}

export interface CounterRecoveryHydration {
	operationUlid: string;
	qtyInput: string;
	returnCondition: ReturnCondition;
	notes: string;
	hydratedOperationId: string;
}

export function resolveCounterRecoveryHydration(
	input: CounterRecoveryHydrationInput
): CounterRecoveryHydration | null {
	if (!input.open || !input.logId || !input.reservation) return null;
	if (input.reservation.mode !== 'PHYSICAL') return null;
	if (input.hydratedOperationId === input.reservation.operation_id) return null;

	return {
		operationUlid: input.reservation.operation_id,
		qtyInput: input.reservation.qty_returned ?? '',
		returnCondition: input.reservation.return_condition ?? 'READY',
		notes: input.reservation.notes ?? '',
		hydratedOperationId: input.reservation.operation_id
	};
}

export interface NonPhysicalRecoveryHydrationInput {
	open: boolean;
	logId: string | null | undefined;
	reservation?: {
		mode: string;
		operation_id: string;
		clear_reason?: NonPhysicalClearReason;
		notes?: string;
	} | null;
	hydratedOperationId: string | null;
}

export interface NonPhysicalRecoveryHydration {
	operationUlid: string;
	reason: NonPhysicalClearReason;
	notes: string;
	hydratedOperationId: string;
}

export function resolveNonPhysicalRecoveryHydration(
	input: NonPhysicalRecoveryHydrationInput
): NonPhysicalRecoveryHydration | null {
	if (!input.open || !input.logId || !input.reservation) return null;
	if (input.reservation.mode !== 'NON_PHYSICAL') return null;
	if (input.hydratedOperationId === input.reservation.operation_id) return null;

	return {
		operationUlid: input.reservation.operation_id,
		reason: input.reservation.clear_reason ?? 'lost',
		notes: input.reservation.notes ?? '',
		hydratedOperationId: input.reservation.operation_id
	};
}

/**
 * Canonical Thai labels for the return-reservation mode (which counter/flow currently
 * holds an in-progress return for a loan). Single source of truth — reused across the
 * Counter Return, Non-Physical Clear, and Bulk Gate Clear dialogs so the raw internal
 * mode value never leaks into user-facing messages.
 */
const RETURN_RESERVATION_MODE_LABELS: Record<string, string> = {
	PHYSICAL: 'ตรวจรับคืนที่เคาน์เตอร์',
	NON_PHYSICAL: 'ตัดจำหน่ายโดยไม่มีของคืน',
	BULK: 'เคลียร์ผ่านจุดรวมคืน'
};

export function getReturnReservationModeLabel(mode: string | null | undefined): string {
	if (!mode) return 'ไม่ระบุ';
	return RETURN_RESERVATION_MODE_LABELS[mode] ?? mode;
}

export function isReturnReservationModeCollision(
	reservation: { mode: string } | null | undefined,
	expectedMode: string
): boolean {
	if (!reservation) return false;
	return reservation.mode !== expectedMode;
}
