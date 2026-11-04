import type { Attachment } from 'svelte/attachments';
import { isWholeNumberText } from '../domain/unit-quantity';

/**
 * Refuses non-digit typing, pasting and dropping into a quantity box while `isWhole()` is true.
 * `isWhole` is read per event, so a unit change switches the behaviour with no re-attach.
 */
export function wholeNumberInput(
	isWhole: () => boolean,
	onRefuse?: () => void,
	onAccept?: () => void
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
		if (onAccept) {
			input.addEventListener('input', onAccept);
			input.addEventListener('blur', onAccept);
		}
		return () => {
			input.removeEventListener('beforeinput', beforeInput);
			input.removeEventListener('paste', paste);
			input.removeEventListener('drop', drop);
			if (onAccept) {
				input.removeEventListener('input', onAccept);
				input.removeEventListener('blur', onAccept);
			}
		};
	};
}

/** Remembers which quantity box (by key) last refused a keystroke, so its note can show. */
export class WholeNumberGuard {
	#refused = $state<string | null>(null);

	attach(isWhole: () => boolean, key = ''): Attachment<HTMLInputElement> {
		return wholeNumberInput(
			isWhole,
			() => (this.#refused = key),
			() => {
				if (this.#refused === key) this.#refused = null;
			}
		);
	}

	isRefused(key = ''): boolean {
		return this.#refused === key;
	}
}
