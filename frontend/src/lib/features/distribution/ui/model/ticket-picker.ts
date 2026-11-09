import type { RequisitionTicketStatus } from '../../domain/food-supplies';
import { needsCloseOutAction } from './desk-mode';

/**
 * Tickets whose text contains every word of `query` (any order, case-insensitive), so
 * "เย็น ยิม" finds the dinner ticket for the gym point. `textOf` gives the searchable text.
 */
export function searchTickets<T>(
	tickets: readonly T[],
	query: string,
	textOf: (ticket: T) => string
): T[] {
	const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return [...tickets];
	return tickets.filter((ticket) => {
		const text = textOf(ticket).toLowerCase();
		return words.every((word) => text.includes(word));
	});
}

/** Close-out tab groups: what the desk must do now, what waits on the warehouse, what is done. */
export type CloseOutGroup = 'action' | 'waiting' | 'done';

export const CLOSE_OUT_GROUPS: readonly { id: CloseOutGroup; label: string }[] = [
	{ id: 'action', label: 'ต้องทำตอนนี้' },
	{ id: 'waiting', label: 'รอคลัง' },
	{ id: 'done', label: 'เสร็จแล้ว' }
];

/** The one rule for what the desk must act on: close the shift, then send the leftovers back. */
export function closeOutGroup(status: RequisitionTicketStatus): CloseOutGroup {
	if (status === 'DISTRIBUTING' || needsCloseOutAction({ status })) return 'action';
	if (status === 'COMPLETED') return 'done';
	return 'waiting';
}

/**
 * The group to show: the user's pick while it still has tickets, else the group of a pinned
 * ticket (the one just closed or submitted), else the first group with tickets — "ต้องทำ" first.
 */
export function resolveCloseOutGroup(
	picked: CloseOutGroup | null,
	tickets: readonly { _id: string; status: RequisitionTicketStatus }[],
	pinnedTicketId: string
): CloseOutGroup {
	const has = (g: CloseOutGroup) => tickets.some((t) => closeOutGroup(t.status) === g);
	if (picked && has(picked)) return picked;
	const pinned = tickets.find((t) => t._id === pinnedTicketId);
	if (pinned) return closeOutGroup(pinned.status);
	return CLOSE_OUT_GROUPS.find((g) => has(g.id))?.id ?? 'action';
}
