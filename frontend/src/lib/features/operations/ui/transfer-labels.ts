/**
 * T-13 — Thai display labels shared by the transfer list and the transfer detail page, so both
 * views name a status the same way.
 */

import type { TransferStatus } from '../domain/operations';
import type { TransferSide, TransferStepKey } from '../domain/transfer.view';

export const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = {
	requested: 'รอส่งมอบ',
	shipped: 'ระหว่างขนส่ง',
	received: 'ส่งมอบสำเร็จ',
	cancelled: 'ยกเลิกแล้ว',
	disputed: 'ระงับไว้'
};

/** CR-091 FR-02 — detail-page side label; the list keeps its own short two-way badge (FR-06). */
export const TRANSFER_SIDE_LABEL: Record<TransferSide, string> = {
	source: 'ต้นทาง (ศูนย์ของคุณ)',
	destination: 'ปลายทาง (ศูนย์ของคุณ)',
	none: 'ไม่ใช่ศูนย์ของคำร้องนี้'
};

/** CR-091 FR-04 — one label per timeline step. */
export const TRANSFER_STEP_LABEL: Record<TransferStepKey, string> = {
	requested: 'สร้างคำร้อง',
	disputed: 'คัดค้าน / ระงับ',
	shipped: 'อนุมัติส่งมอบ',
	received: 'ยืนยันรับเข้า'
};
