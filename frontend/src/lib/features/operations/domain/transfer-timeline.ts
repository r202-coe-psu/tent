import type { StockTransfer } from './operations';

export type TransferTimelineStepKey =
	'requested' | 'disputed' | 'shipped' | 'received' | 'cancelled';

export interface TransferTimelineStep {
	key: TransferTimelineStepKey;
	label: string;
	at: string;
	/** Absent for `cancelled` — the cancel transition records no actor. */
	by?: string;
}

const STEP_LABEL: Record<TransferTimelineStepKey, string> = {
	requested: 'สร้างคำขอ',
	disputed: 'ระงับ/คัดค้าน',
	shipped: 'ส่งมอบ',
	received: 'รับเข้า',
	cancelled: 'ยกเลิก'
};

/**
 * Ordered (oldest first) steps of a transfer. `cancelled` has no timeline entry, so it falls
 * back to `updated_at` (the time of the last write) and carries no `by`.
 */
export function transferTimelineSteps(
	transfer: Pick<StockTransfer, 'timeline' | 'status' | 'updated_at'>
): TransferTimelineStep[] {
	const steps: TransferTimelineStep[] = [];
	for (const key of ['requested', 'disputed', 'shipped', 'received'] as const) {
		const event = transfer.timeline[key];
		if (event) steps.push({ key, label: STEP_LABEL[key], at: event.at, by: event.by });
	}
	steps.sort((a, b) => a.at.localeCompare(b.at));
	if (transfer.status === 'cancelled') {
		steps.push({ key: 'cancelled', label: STEP_LABEL.cancelled, at: transfer.updated_at });
	}
	return steps;
}
