import type {
	RequisitionTicketStatus,
	Flow2RequisitionType,
	MealPeriod
} from '../../domain/food-supplies';

/**
 * All 9 canonical requisition ticket statuses defined in CR-121 and schema.md.
 */
export const REQUISITION_TICKET_STATUSES: readonly RequisitionTicketStatus[] = [
	'PENDING_PICK',
	'READY_FOR_DISPATCH',
	'IN_TRANSIT',
	'DISTRIBUTING',
	'SHIFT_CLOSED',
	'RETURN_PENDING_RECEIPT',
	'RETURN_COMPLETED',
	'COMPLETED',
	'CANCELLED'
] as const;

/**
 * Canonical Thai UI labels for each status. Single source of truth.
 */
export const TICKET_STATUS_LABELS: Record<RequisitionTicketStatus, string> = {
	PENDING_PICK: 'รอจัดของ',
	READY_FOR_DISPATCH: 'พร้อมส่งออก',
	IN_TRANSIT: 'กำลังนำส่ง',
	DISTRIBUTING: 'กำลังแจกจ่าย',
	SHIFT_CLOSED: 'ปิดรอบแจกแล้ว',
	RETURN_PENDING_RECEIPT: 'รอคลังตรวจรับคืน',
	RETURN_COMPLETED: 'ตรวจรับคืนแล้ว',
	COMPLETED: 'เสร็จสมบูรณ์',
	CANCELLED: 'ยกเลิก'
};

/**
 * Civic Light Design System 360-degree perimeter border tokens for each status badge.
 */
export const TICKET_STATUS_BADGE_CLASSES: Record<RequisitionTicketStatus, string> = {
	PENDING_PICK: 'border border-amber-200 bg-amber-50 text-amber-900',
	READY_FOR_DISPATCH: 'border border-sky-200 bg-sky-50 text-sky-900',
	IN_TRANSIT: 'border border-blue-200 bg-blue-50 text-blue-900',
	DISTRIBUTING: 'border border-emerald-200 bg-emerald-50 text-emerald-900',
	SHIFT_CLOSED: 'border border-purple-200 bg-purple-50 text-purple-900',
	RETURN_PENDING_RECEIPT: 'border border-orange-200 bg-orange-50 text-orange-900',
	RETURN_COMPLETED: 'border border-teal-200 bg-teal-50 text-teal-900',
	COMPLETED: 'border border-slate-200 bg-slate-100 text-slate-800',
	CANCELLED: 'border border-red-200 bg-red-50 text-red-800'
};

/**
 * Returns canonical Thai label for a given ticket status.
 */
export function getTicketStatusLabel(status: RequisitionTicketStatus): string {
	return TICKET_STATUS_LABELS[status] ?? status;
}

/**
 * Returns Civic Light Design System badge style class for a given ticket status.
 */
export function getTicketStatusBadgeClass(status: RequisitionTicketStatus): string {
	return (
		TICKET_STATUS_BADGE_CLASSES[status] ?? 'border border-slate-200 bg-slate-50 text-slate-700'
	);
}

/**
 * Canonical Thai UI labels for ticket types.
 */
export const REQUISITION_TYPE_LABELS: Record<Flow2RequisitionType, string> = {
	food: 'อาหาร',
	supplies: 'พัสดุ'
};

export function getRequisitionTypeLabel(type: Flow2RequisitionType): string {
	return REQUISITION_TYPE_LABELS[type] ?? type;
}

/**
 * Canonical Thai UI labels for food meal periods.
 */
export const MEAL_PERIOD_LABELS: Record<MealPeriod, string> = {
	breakfast: 'เช้า',
	lunch: 'กลางวัน',
	dinner: 'เย็น',
	snack: 'อาหารว่าง'
};

export function getMealPeriodLabel(meal: MealPeriod): string {
	return MEAL_PERIOD_LABELS[meal] ?? meal;
}
