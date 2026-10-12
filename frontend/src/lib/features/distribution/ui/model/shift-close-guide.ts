import type { RequisitionTicketStatus } from '../../domain/food-supplies';

/** The three things the desk does to finish a ticket, in order. */
export const SHIFT_CLOSE_STEPS = [
	{ key: 'close', label: 'ตรวจนับและปิดรอบ' },
	{ key: 'submit', label: 'ส่งของเหลือคืนคลัง' },
	{ key: 'warehouse', label: 'คลังตรวจรับ' }
] as const;

export type ShiftCloseStepKey = (typeof SHIFT_CLOSE_STEPS)[number]['key'];

export interface ShiftCloseGuide {
	/** Step in progress, or `done` once nothing is left for anyone to do. */
	current: ShiftCloseStepKey | 'done';
	/** One line telling the operator what to do now. */
	nextAction: string;
	/** Whether the next action is on the desk (false = waiting on the warehouse, or finished). */
	deskActs: boolean;
}

/** Where a ticket sits in the close-out sequence and what the desk should do next. */
export function shiftCloseGuide(status: RequisitionTicketStatus): ShiftCloseGuide {
	switch (status) {
		case 'DISTRIBUTING':
			return {
				current: 'close',
				nextAction:
					'นับของที่เหลืออยู่จริง ใส่ในช่อง "ส่งคืนคลัง" แล้วกด "ยืนยันปิดรอบแจกจ่าย" ด้านล่าง',
				deskActs: true
			};
		case 'SHIFT_CLOSED':
			return {
				current: 'submit',
				nextAction: 'นำของที่เหลือไปส่งคลัง แล้วกด "ส่งคืนพัสดุกลับคลังกลาง" ด้านล่าง',
				deskActs: true
			};
		case 'RETURN_PENDING_RECEIPT':
			return {
				current: 'warehouse',
				nextAction: 'จุดแจกทำครบแล้ว รอเจ้าหน้าที่คลังตรวจรับของคืนในระบบหลังบ้าน',
				deskActs: false
			};
		default:
			return { current: 'done', nextAction: 'ตั๋วนี้ปิดงานเรียบร้อยแล้ว', deskActs: false };
	}
}

/** `done` / `current` / `todo` for one step of the guide. */
export function shiftCloseStepState(
	step: ShiftCloseStepKey,
	current: ShiftCloseGuide['current']
): 'done' | 'current' | 'todo' {
	if (current === 'done') return 'done';
	const order = SHIFT_CLOSE_STEPS.map((s) => s.key);
	const at = order.indexOf(current);
	const index = order.indexOf(step);
	if (index < at) return 'done';
	return index === at ? 'current' : 'todo';
}
