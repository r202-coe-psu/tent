/**
 * T-13 — Thai display labels shared by the transfer list and the transfer detail page, so both
 * views name a status the same way.
 */

import type { TransferStatus } from '../domain/operations';

export const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = {
	requested: 'รอส่งมอบ',
	shipped: 'ระหว่างขนส่ง',
	received: 'ส่งมอบสำเร็จ',
	cancelled: 'ยกเลิกแล้ว',
	disputed: 'ระงับไว้'
};
