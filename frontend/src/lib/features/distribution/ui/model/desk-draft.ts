/**
 * CR-200 FR-DFS-05 — a desk mode switch unmounts the current step's form, so the page asks
 * before switching while any form holds typed input that has not been confirmed yet.
 */

/** The quantity a handover form starts at and resets to after each recorded handover. */
export const HANDOVER_DEFAULT_QTY = '1';

/** A handover form (food or supplies) is a draft once its quantity or notes leave the defaults. */
export function isHandoverDraft(form: { qtyInput: string; notesInput: string }): boolean {
	return form.qtyInput.trim() !== HANDOVER_DEFAULT_QTY || form.notesInput.trim() !== '';
}

/** The close-out form is a draft once any returned quantity differs from its prefilled value. */
export function isReturnedQtyDraft(
	initial: Readonly<Record<string, string>>,
	inputs: Readonly<Record<string, string>>
): boolean {
	return Object.keys(inputs).some((itemId) => inputs[itemId].trim() !== (initial[itemId] ?? ''));
}

/**
 * The page owns one registry; each mounted form registers a getter for its draft state and
 * unregisters on unmount. Getters are read only when the user asks to switch mode.
 */
export class DeskDrafts {
	#sources = new Set<() => boolean>();

	track(isDraft: () => boolean): () => void {
		this.#sources.add(isDraft);
		return () => this.#sources.delete(isDraft);
	}

	hasDraft(): boolean {
		for (const isDraft of this.#sources) {
			if (isDraft()) return true;
		}
		return false;
	}
}
