import { matchesShelterCloseConfirm, type ShelterCloseResult } from './shelter-close';

/**
 * Pure UI helpers for the shelter close flow (CR-219 FR-15..FR-21). No I/O, no Svelte.
 */

/** FR-15: the confirm modal opens when a save would move a not-yet-closed shelter to `closed`. */
export function needsShelterCloseModal(
	originalStatus: string | null | undefined,
	nextStatus: string | null | undefined
): boolean {
	return nextStatus === 'closed' && originalStatus !== 'closed';
}

/**
 * FR-23: `closed` is only offered to SA / the shelter manager of the shelter. An already-closed
 * shelter keeps showing its current value so the field never renders empty.
 */
export function selectableOperationStatuses<T extends { value: string }>(
	options: readonly T[],
	opts: { canClose: boolean; currentStatus: string | null | undefined }
): T[] {
	if (opts.canClose || opts.currentStatus === 'closed') return [...options];
	return options.filter((o) => o.value !== 'closed');
}

export interface ShelterCloseCountRow {
	status: string;
	label: string;
	count: number;
}

/** FR-19/FR-20: only statuses with a positive count, labelled, in descending-count order. */
export function shelterCloseCountRows(
	byStatus: Record<string, number>,
	labels: Record<string, string>
): ShelterCloseCountRow[] {
	return Object.entries(byStatus)
		.filter(([, count]) => count > 0)
		.map(([status, count]) => ({ status, label: labels[status] ?? status, count }))
		.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'th'));
}

export interface ShelterCloseOutcome {
	kind: 'success' | 'error';
	message: string;
}

/** FR-21: the toast shown after a close attempt. */
export function describeShelterCloseResult(result: ShelterCloseResult): ShelterCloseOutcome {
	if (result.closed) {
		return {
			kind: 'success',
			message: `ปิดศูนย์แล้ว · เช็คเอาต์ ${result.checked_out} คน · ยกเลิก ${result.cancelled} คน`
		};
	}
	if (result.failed.length > 0) {
		return {
			kind: 'error',
			message: `ล้มเหลว ${result.failed.length} คน — ศูนย์ยังไม่ถูกปิด กดปิดอีกครั้งเพื่อทำต่อ`
		};
	}
	return {
		kind: 'error',
		message: 'ยังมีผู้พักพิงค้างอยู่ — ศูนย์ยังไม่ถูกปิด กดปิดอีกครั้งเพื่อทำต่อ'
	};
}

/**
 * FR-19: what an open/close request on the dialog does. While the close request runs the
 * dialog stays open (escape, outside click and "ยกเลิก" are all ignored); otherwise a close
 * is a cancel (FR-18 — the form reverts its status).
 */
export function shelterCloseDialogOpenChange(
	running: boolean,
	requestedOpen: boolean
): { open: boolean; cancelled: boolean } {
	if (running) return { open: true, cancelled: false };
	return { open: requestedOpen, cancelled: !requestedOpen };
}

/** FR-17/FR-19: the confirm button is live only once counts loaded, the phrase matches, and nothing runs. */
export function canConfirmShelterClose(input: {
	running: boolean;
	previewLoaded: boolean;
	typed: string;
	code: string;
	name: string;
}): boolean {
	return (
		!input.running &&
		input.previewLoaded &&
		matchesShelterCloseConfirm(input.typed, input.code, input.name)
	);
}
