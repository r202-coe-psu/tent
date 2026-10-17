/** New array with the item at `from` moved to end at index `to`; an invalid move returns a copy. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
	const result = [...list];
	const inRange = (i: number) => Number.isInteger(i) && i >= 0 && i < list.length;
	if (!inRange(from) || !inRange(to) || from === to) return result;
	const [item] = result.splice(from, 1);
	result.splice(to, 0, item);
	return result;
}

/**
 * Final index of the dragged row: how many other-row midpoints (clientY, top to bottom) sit above
 * the pointer. Composes with {@link moveItem}: `moveItem(list, from, dropIndex(midpointsWithoutFrom, y))`.
 */
export function dropIndex(midpoints: readonly number[], pointerY: number): number {
	return midpoints.filter((m) => m < pointerY).length;
}

/** Whether two lists hold the same documents (by `_id`) in the same sequence. */
export function sameOrder(a: readonly { _id: string }[], b: readonly { _id: string }[]): boolean {
	return a.length === b.length && a.every((item, i) => item._id === b[i]._id);
}
