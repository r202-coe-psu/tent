import { qtyGt } from '$lib/utils/qty';
import {
	calculateDistributedQtyForTicketItem,
	calculateInHandQtyForTicketItem,
	isDuplicateMealDistributionLog,
	type DistributionLog,
	type MealPeriod,
	type TicketItem
} from '../../domain/food-supplies';

/**
 * Normalized UI-level recipient selection for frontline handover.
 * Ephemeral presentation state only — never persisted directly.
 * Volunteer recipient is omitted/unsupported because frontend referential existence lookup is missing.
 */
export type FrontlineRecipientSelection =
	| {
			recipientType: 'evacuee';
			recipientId: string; // 'evacuee:{ulid}'
			householdId?: string; // 'household:{ulid}'
			label: string;
			phone?: string | null;
			stayInfo?: string;
	  }
	| {
			recipientType: 'outside';
			recipientId: null;
			label: string;
			notes?: string;
	  };

export interface ItemCapacitySummary {
	allocatedQty: string;
	distributedQty: string;
	inHandQty: string;
	isExhausted: boolean;
}

/**
 * Computes the capacity summary for a ticket line item based on ticket-scoped logs.
 */
export function getItemCapacitySummary(
	ticketId: string,
	targetItem: Pick<TicketItem, 'item_id' | 'allocated_qty'>,
	logs: readonly DistributionLog[]
): ItemCapacitySummary {
	const distributedQty = calculateDistributedQtyForTicketItem(ticketId, targetItem.item_id, logs);
	const inHandQty = calculateInHandQtyForTicketItem(ticketId, targetItem, logs);
	return {
		allocatedQty: targetItem.allocated_qty || '0',
		distributedQty,
		inHandQty,
		isExhausted: !qtyGt(inHandQty, '0')
	};
}

/**
 * Validates whether the selected recipient is eligible to receive the given item.
 * Strictly enforces that returnable loan items require an identifiable evacuee recipient.
 */
export function canRecipientReceiveItem(
	recipient: FrontlineRecipientSelection | null,
	isReturnable: boolean
): boolean {
	if (!recipient) return false;
	if (isReturnable) {
		return recipient.recipientType === 'evacuee' && Boolean(recipient.recipientId);
	}
	return true;
}

/**
 * Returns human-readable Thai error message explaining why the recipient cannot receive this item.
 */
export function getRecipientValidationErrorMessage(
	recipient: FrontlineRecipientSelection | null,
	isReturnable: boolean
): string | null {
	if (!recipient) {
		return 'กรุณาเลือกผู้รับก่อนทำรายการ';
	}
	if (isReturnable && recipient.recipientType === 'outside') {
		return "สิ่งของประเภท 'ต้องคืน' ต้องระบุผู้ประสบภัยผู้รับผิดชอบ (ไม่สามารถแจกให้บุคคลภายนอกได้)";
	}
	if (isReturnable && !recipient.recipientId) {
		return "สิ่งของประเภท 'ต้องคืน' จำเป็นต้องมีรหัสผู้รับที่ระบุตัวตนได้";
	}
	return null;
}

/**
 * Advisory check to determine if the recipient has already received a meal of the same period today.
 * Reuses the single-source-of-truth domain predicate `isDuplicateMealDistributionLog`.
 */
export function checkDuplicateMealAdvisory(
	recipientLogs: readonly DistributionLog[] | undefined,
	targetMeal: MealPeriod | undefined,
	referenceIsoOrDate: string | Date = new Date().toISOString()
): { isDuplicate: boolean; priorLog: DistributionLog | null } {
	if (!recipientLogs || recipientLogs.length === 0 || !targetMeal) {
		return { isDuplicate: false, priorLog: null };
	}

	const priorLog =
		recipientLogs.find((log) =>
			isDuplicateMealDistributionLog(log, targetMeal, referenceIsoOrDate)
		) ?? null;

	return {
		isDuplicate: Boolean(priorLog),
		priorLog
	};
}
