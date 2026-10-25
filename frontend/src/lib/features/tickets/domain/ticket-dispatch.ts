import type {
	DispatchLotAllocation,
	DispatchLotFailureReason,
	DispatchLotValidation
} from '$lib/features/distribution';

/** item_id -> the physical lots (and qty from each) a kitchen ticket line is dispatched from (CR-178). */
export type TicketLotAllocations = Record<string, DispatchLotAllocation[]>;

const LOT_FAILURE_MESSAGES: Record<DispatchLotFailureReason, string> = {
	no_lots: 'ยังไม่ได้เลือก lot',
	invalid_lot_ref: 'อ้างอิง lot ไม่ถูกต้อง',
	duplicate_lot: 'เลือก lot ซ้ำ',
	non_positive_qty: 'จำนวนจาก lot ต้องมากกว่า 0',
	unknown_lot: 'ไม่พบ lot นี้ในสต็อกของรายการ',
	expired_lot: 'lot หมดอายุแล้ว',
	exceeds_lot_balance: 'จำนวนเกินยอดคงเหลือของ lot',
	sum_mismatch: 'ผลรวมจำนวนจาก lot ไม่เท่ากับจำนวนที่ต้องปล่อย'
};

/** Thai error message for one failed line of the per-lot dispatch validation (CR-178 FR-6). */
export function describeLotFailure(
	itemName: string,
	allocatedQty: string,
	failure: Extract<DispatchLotValidation, { ok: false }>
): string {
	const lotPart = failure.lot_ref ? ` (${failure.lot_ref})` : '';
	const totalPart =
		failure.reason === 'sum_mismatch'
			? ` (เลือกแล้ว ${failure.total} จากที่ต้องปล่อย ${allocatedQty})`
			: '';
	return `ปล่อยของไม่ได้: ${itemName} — ${LOT_FAILURE_MESSAGES[failure.reason]}${lotPart}${totalPart}`;
}
