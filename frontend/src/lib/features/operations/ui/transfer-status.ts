import type { TransferStatus } from '../domain/operations';

export const STATUS_LABEL: Record<TransferStatus, string> = {
	requested: 'รอส่งมอบ',
	shipped: 'ระหว่างขนส่ง',
	received: 'ส่งมอบสำเร็จ',
	cancelled: 'ยกเลิกแล้ว',
	disputed: 'ระงับไว้'
};

export function statusBadgeClass(status: TransferStatus): string {
	switch (status) {
		case 'requested':
			return 'border-amber-200 bg-amber-50 text-amber-900';
		case 'shipped':
			return 'border-sky-200 bg-sky-50 text-sky-900';
		case 'received':
			return 'border-emerald-200 bg-emerald-50 text-emerald-900';
		case 'cancelled':
			return 'border-border bg-muted text-muted-foreground';
		case 'disputed':
			return 'border-rose-200 bg-rose-50 text-rose-900';
	}
}
