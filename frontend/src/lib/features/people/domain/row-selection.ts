/**
 * Pure helpers for table multi-select (Ctrl/⌘ toggle, Shift range).
 * UI owns navigation on plain click; this module never navigates.
 */

export function toggleId(selected: readonly string[], id: string): string[] {
	return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}

/** Inclusive range of ids between two indices in the current view order. */
export function selectRange(
	idsInView: readonly string[],
	anchorIndex: number,
	targetIndex: number
): string[] {
	if (idsInView.length === 0) return [];
	const lo = Math.min(anchorIndex, targetIndex);
	const hi = Math.max(anchorIndex, targetIndex);
	const start = Math.max(0, lo);
	const end = Math.min(idsInView.length - 1, hi);
	if (start > end) return [];
	return idsInView.slice(start, end + 1);
}

export type ApplyRowClickSelectionInput = {
	selected: readonly string[];
	ids: readonly string[];
	index: number;
	lastIndex: number | null;
	ctrl: boolean;
	shift: boolean;
};

export type ApplyRowClickSelectionResult = {
	nextSelected: string[];
	nextLastIndex: number | null;
};

/**
 * Apply modifier-key row click to selection.
 * - shift: replace selection with inclusive range from lastIndex (or index) → index
 * - ctrl: toggle the clicked id; update lastIndex
 * - plain: leave selection and lastIndex unchanged (caller navigates)
 * Shift wins when both shift and ctrl are set.
 */
export function applyRowClickSelection({
	selected,
	ids,
	index,
	lastIndex,
	ctrl,
	shift
}: ApplyRowClickSelectionInput): ApplyRowClickSelectionResult {
	if (shift) {
		const anchor = lastIndex ?? index;
		return {
			nextSelected: selectRange(ids, anchor, index),
			nextLastIndex: lastIndex ?? index
		};
	}

	if (ctrl) {
		const id = ids[index];
		if (id === undefined) {
			return { nextSelected: [...selected], nextLastIndex: lastIndex };
		}
		return {
			nextSelected: toggleId(selected, id),
			nextLastIndex: index
		};
	}

	return {
		nextSelected: [...selected],
		nextLastIndex: lastIndex
	};
}
