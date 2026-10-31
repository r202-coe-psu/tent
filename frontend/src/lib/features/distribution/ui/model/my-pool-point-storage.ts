/**
 * Per-device, per-shelter memory of the distribution staff member's "my point" (a storage point id,
 * or the `unspecified` sentinel for pools without a point). UI-only convenience: every access is
 * guarded, so unavailable or full storage just means the choice is not remembered.
 */

/** Sentinel value: pools that carry no storage point. */
export const MY_POOL_POINT_UNSPECIFIED = 'unspecified';

/** localStorage key for one shelter's "my point". */
export function myPoolPointKey(shelterCode: string): string {
	return `tent.distribution.myPoolPoint:${shelterCode}`;
}

/** The remembered point for this shelter, or `null` when none is stored or storage is unavailable. */
export function readMyPoolPoint(shelterCode: string | null | undefined): string | null {
	if (!shelterCode || typeof localStorage === 'undefined') return null;
	try {
		return localStorage.getItem(myPoolPointKey(shelterCode)) || null;
	} catch {
		return null;
	}
}

/** Remember the point for this shelter; silently skipped when storage is unavailable. */
export function writeMyPoolPoint(shelterCode: string | null | undefined, value: string): void {
	if (!shelterCode || !value || typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(myPoolPointKey(shelterCode), value);
	} catch {
		/* ignore quota / private mode */
	}
}

/**
 * The stored point to actually use. A stored storage point id that is missing from an authoritative
 * (`loaded`) points list was deleted, so it resolves to `null` (back to the placeholder). `null`, the
 * unspecified sentinel, and any value while the list is not loaded are returned unchanged.
 */
export function resolveMyPoolPoint(
	stored: string | null,
	points: readonly { id: string }[],
	loaded: boolean
): string | null {
	if (stored === null || stored === MY_POOL_POINT_UNSPECIFIED || !loaded) return stored;
	return points.some((p) => p.id === stored) ? stored : null;
}

/** Forget the point for this shelter; silently skipped when storage is unavailable. */
export function clearMyPoolPoint(shelterCode: string | null | undefined): void {
	if (!shelterCode || typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(myPoolPointKey(shelterCode));
	} catch {
		/* ignore */
	}
}
