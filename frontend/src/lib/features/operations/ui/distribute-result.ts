/**
 * Plain-language report of a multi-lot issue (CR-143 FR-A9): how many lots were cut,
 * how much, and how much is still not cut. Pure — the form only picks the toast kind.
 */

import type { DistributeAcrossLotsResult } from '../application/distribute-across-lots';

export type DistributeReportKind = 'success' | 'partial' | 'failed';

export interface DistributeReport {
	kind: DistributeReportKind;
	message: string;
}

export function describeDistributeResult(
	result: DistributeAcrossLotsResult,
	unitLabel: string
): DistributeReport {
	const lots = result.distributed.length;
	if (result.complete) {
		return {
			kind: 'success',
			message:
				lots > 1 ? `เบิกแล้ว ${result.distributedQty} ${unitLabel} จาก ${lots} ล็อต` : 'เบิกแล้ว'
		};
	}
	const reason = result.failure?.message ?? 'บันทึกไม่สำเร็จ';
	if (lots === 0) {
		return { kind: 'failed', message: `ยังไม่ได้ตัดสต็อก — ${reason}` };
	}
	return {
		kind: 'partial',
		message:
			`ตัดสำเร็จ ${lots} ล็อต รวม ${result.distributedQty} ${unitLabel} ` +
			`แต่ยังไม่ได้ตัดอีก ${result.remainingQty} ${unitLabel} — ${reason}. ` +
			`รายการที่ตัดแล้วจะไม่ถูกย้อนกลับ`
	};
}
