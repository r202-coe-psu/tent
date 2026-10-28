/**
 * Per-device, per-shelter memory of the last bulk return pool an entry was saved to. UI-only
 * convenience: every access is guarded, so unavailable or full storage just means the pool is not
 * remembered.
 */

/** localStorage key for one shelter's last-used pool. */
export function lastBulkReturnPoolKey(shelterCode: string): string {
	return `tent.distribution.lastBulkReturnPool:${shelterCode}`;
}

/** The remembered pool id for this shelter, or `null` when none is stored or storage is unavailable. */
export function readLastBulkReturnPool(shelterCode: string): string | null {
	if (!shelterCode || typeof localStorage === 'undefined') return null;
	try {
		return localStorage.getItem(lastBulkReturnPoolKey(shelterCode));
	} catch {
		return null;
	}
}

/** Remember the pool for this shelter; silently skipped when storage is unavailable. */
export function writeLastBulkReturnPool(shelterCode: string, poolId: string): void {
	if (!shelterCode || !poolId || typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(lastBulkReturnPoolKey(shelterCode), poolId);
	} catch {
		/* ignore quota / private mode */
	}
}
