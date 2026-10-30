/**
 * Which queue window counts as picked on the booking form.
 *
 * A window is picked for one shelter, day and queue. Changing any of them, or the window
 * filling or closing before submit, means nothing is picked any more — even when the new
 * list happens to have a window with the same label. Derived, so nothing has to clear it.
 */

export type SlotOption = { label: string; status: string };

export function slotContextKey(shelterCode: string, date: string, mode: string | null): string {
	return `${shelterCode}|${date}|${mode ?? ''}`;
}

export function pickedSlot(input: {
	slotTime: string;
	slotFor: string;
	context: string;
	slots: readonly SlotOption[];
}): string {
	if (!input.slotTime || input.slotFor !== input.context) return '';
	const open = input.slots.some((s) => s.label === input.slotTime && s.status === 'available');
	return open ? input.slotTime : '';
}
