/**
 * Sort orders for the back-office evacuee list (#1061).
 *
 * "Newest/oldest" ride on `_id` (`evacuee:{ULID}`): ULIDs are monotonic by creation time, so
 * `_all_docs` can page them server-side in either direction without a Mango index.
 */
export const EVACUEE_SORTS = ['newest', 'oldest', 'name'] as const;

export type EvacueeSort = (typeof EVACUEE_SORTS)[number];

export const DEFAULT_EVACUEE_SORT: EvacueeSort = 'newest';

export const EVACUEE_SORT_LABELS: Record<EvacueeSort, string> = {
	newest: 'ลงทะเบียนล่าสุดก่อน',
	oldest: 'ลงทะเบียนเก่าสุดก่อน',
	name: 'ชื่อ ก–ฮ'
};

export function isEvacueeSort(value: unknown): value is EvacueeSort {
	return typeof value === 'string' && (EVACUEE_SORTS as readonly string[]).includes(value);
}

type SortableEvacuee = { _id: string; first_name: string; last_name: string };

const thaiCollator = new Intl.Collator('th', { sensitivity: 'base', numeric: true });

function compareIds(a: SortableEvacuee, b: SortableEvacuee): number {
	return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
}

function compareNames(a: SortableEvacuee, b: SortableEvacuee): number {
	return (
		thaiCollator.compare(a.first_name.trim(), b.first_name.trim()) ||
		thaiCollator.compare(a.last_name.trim(), b.last_name.trim()) ||
		compareIds(a, b)
	);
}

/** Return a new array in the requested order; the input is not mutated. */
export function sortEvacuees<T extends SortableEvacuee>(
	items: readonly T[],
	sort: EvacueeSort
): T[] {
	const copy = [...items];
	switch (sort) {
		case 'oldest':
			return copy.sort(compareIds);
		case 'name':
			return copy.sort(compareNames);
		case 'newest':
		default:
			return copy.sort((a, b) => compareIds(b, a));
	}
}
