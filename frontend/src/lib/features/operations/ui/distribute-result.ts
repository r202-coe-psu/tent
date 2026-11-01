/**
 * Plain-language report of a batch issue (#837, CR-143 FR-A9): how many lines were cut, how much
 * of each item, and what is still not cut. Pure — the form only picks the toast kind.
 */

import { hasLandedRows, landedQty, type DistributeLineDraft } from '../domain/distribute-batch';

export type DistributeReportKind = 'success' | 'partial' | 'failed';

export interface BatchReportLabels {
	itemName: (itemId: string) => string;
	/** Unit label of the item's base unit — ledger quantities are always in it. */
	baseUnitLabel: (itemId: string) => string;
}

export interface BatchReportItem {
	itemId: string;
	name: string;
	/** Base-unit quantity of this item that is in the ledger. */
	qty: string;
	unitLabel: string;
}

export interface DistributeReport {
	kind: DistributeReportKind;
	message: string;
	/** Per-item quantities withdrawn so far, "name qty unit" joined for a toast description. */
	detail: string;
	items: BatchReportItem[];
}

/** One line's status for its card, or null while it is untouched. */
export function describeLineStatus(
	line: DistributeLineDraft,
	labels: BatchReportLabels
): string | null {
	const unit = labels.baseUnitLabel(line.item_id);
	if (line.status.kind === 'done') return `เบิกแล้ว ${line.status.distributedQty} ${unit}`;
	if (line.status.kind === 'failed') {
		return hasLandedRows(line)
			? `ตัดแล้ว ${line.status.distributedQty} ${unit} · ยังไม่ได้ตัดอีก ${line.qty} ${unit} — ${line.status.message}`
			: line.status.message;
	}
	return null;
}

/** Report on the lines after a run has been folded into them with `applyBatchRun`. */
export function describeBatchResult(
	lines: readonly DistributeLineDraft[],
	labels: BatchReportLabels
): DistributeReport {
	const landed = lines.filter(hasLandedRows);
	const items = landed.map((line) => ({
		itemId: line.item_id,
		name: labels.itemName(line.item_id),
		qty: landedQty(line),
		unitLabel: labels.baseUnitLabel(line.item_id)
	}));
	const detail = items.map((i) => `${i.name} ${i.qty} ${i.unitLabel}`).join(' · ');

	const total = lines.length;
	const done = lines.filter((line) => line.status.kind === 'done').length;
	if (done === total) {
		return {
			kind: 'success',
			message: total > 1 ? `เบิกแล้ว ${total} รายการ` : 'เบิกแล้ว',
			detail,
			items
		};
	}

	const failedLine = lines.find((line) => line.status.kind === 'failed');
	const reason =
		failedLine?.status.kind === 'failed' ? failedLine.status.message : 'บันทึกไม่สำเร็จ';
	if (landed.length === 0) {
		return { kind: 'failed', message: `ยังไม่ได้ตัดสต็อก — ${reason}`, detail, items };
	}
	const failedName = failedLine ? `${labels.itemName(failedLine.item_id)}: ` : '';
	return {
		kind: 'partial',
		message:
			`ตัดสำเร็จ ${done} จาก ${total} รายการ แต่ยังไม่ได้ตัดอีก ${total - done} รายการ — ` +
			`${failedName}${reason}. รายการที่ตัดแล้วจะไม่ถูกย้อนกลับ`,
		detail,
		items
	};
}
