import type { Attachment } from 'svelte/attachments';
import { isWholeNumberText } from '../domain/unit-quantity';

/**
 * Refuses non-digit typing, pasting and dropping into a quantity box while `isWhole()` is true.
 * `isWhole` is read per event, so a unit change switches the behaviour with no re-attach.
 * `onRefuse` lets the caller show a note.
 */
export function wholeNumberInput(
	isWhole: () => boolean,
	onRefuse?: () => void
): Attachment<HTMLInputElement> {
	return (input) => {
		const refuseUnlessDigits = (e: Event, text: string | null | undefined) => {
			if (!isWhole() || text == null || isWholeNumberText(text)) return;
			e.preventDefault();
			onRefuse?.();
		};
		const beforeInput = (e: InputEvent) => {
			const pasted = e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop';
			refuseUnlessDigits(e, pasted ? e.data?.trim() : e.data);
		};
		const paste = (e: ClipboardEvent) =>
			refuseUnlessDigits(e, e.clipboardData?.getData('text').trim());
		const drop = (e: DragEvent) => refuseUnlessDigits(e, e.dataTransfer?.getData('text').trim());

		input.addEventListener('beforeinput', beforeInput);
		input.addEventListener('paste', paste);
		input.addEventListener('drop', drop);
		return () => {
			input.removeEventListener('beforeinput', beforeInput);
			input.removeEventListener('paste', paste);
			input.removeEventListener('drop', drop);
		};
	};
}

export const REFUSAL_NOTE_MS = 3000;

/**
 * Remembers which quantity box (by key) last refused a keystroke, so its note can show.
 * The note times out instead of clearing on blur: a note that vanishes on mousedown
 * shifts the layout under the pointer and swallows the click on the button below it.
 */
export class WholeNumberGuard {
	#refused = $state<string | null>(null);
	#timer: ReturnType<typeof setTimeout> | undefined;

	attach(isWhole: () => boolean, key = ''): Attachment<HTMLInputElement> {
		return wholeNumberInput(isWhole, () => {
			this.#refused = key;
			clearTimeout(this.#timer);
			this.#timer = setTimeout(() => (this.#refused = null), REFUSAL_NOTE_MS);
		});
	}

	isRefused(key = ''): boolean {
		return this.#refused === key;
	}
}
