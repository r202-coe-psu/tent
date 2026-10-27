import type { KioskScreenType } from '$lib/features/shared/domain/kiosk-screen';
import { isActiveAt, matchesSlot, orderableBanners } from '../domain/kiosk-banner';
import type { KioskBannerSummary } from '../data/kiosk-banner.repository';

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

/**
 * A reorder draft re-based on fresh data: the draft's sequence for ids still saved, then any newly
 * saved ids in their saved order, always as the saved objects. A status toggle or delete while a
 * draft exists changes revs/ids, and saving the stale draft would always 409.
 */
export function reconcileDraft<T extends { _id: string }>(
	draft: readonly T[],
	saved: readonly T[]
): T[] {
	const byId = new Map(saved.map((item) => [item._id, item]));
	const kept = draft.flatMap((item) => byId.get(item._id) ?? []);
	const keptIds = new Set(kept.map((item) => item._id));
	return [...kept, ...saved.filter((item) => !keptIds.has(item._id))];
}

/** What one (group, screen type) slot's summary card shows: counts by state plus the play strip. */
export type ScreenSummary = {
	active: number;
	scheduled: number;
	inactive: number;
	expired: number;
	strip: KioskBannerSummary[];
};

/**
 * Summary of one (group, screen type) slot from the two list views (all slots mixed). `strip` is
 * every not-expired banner of the slot in kiosk play order; each strip item is exactly one of active
 * (live now), inactive (switched off) or scheduled (switched on, not started yet).
 */
export function summarizeScreen(
	current: readonly KioskBannerSummary[],
	expired: readonly KioskBannerSummary[],
	slot: { group_id: string; screen_type: KioskScreenType },
	now: Date
): ScreenSummary {
	const strip = orderableBanners(current, slot, now);
	const active = strip.filter((b) => isActiveAt(b, now)).length;
	const inactive = strip.filter((b) => b.status === 'inactive').length;
	return {
		active,
		scheduled: strip.length - active - inactive,
		inactive,
		expired: expired.filter((b) => matchesSlot(b, slot)).length,
		strip
	};
}
