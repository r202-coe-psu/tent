/**
 * Per-device, per-shelter, per-user memory of the last bulk return pool an entry was saved to.
 * UI-only convenience: every access is guarded, so unavailable or full storage just means the pool
 * is not remembered. The key includes the logged-in user, so another staff member on the same
 * device never starts from the previous user's pool; without a user nothing is read or written.
 */

/** localStorage key for one user's last-used pool in one shelter. */
export function lastBulkReturnPoolKey(shelterCode: string, user: string): string {
	return `tent.distribution.lastBulkReturnPool:${shelterCode}:${user}`;
}

/** The remembered pool id, or `null` when none is stored, there is no user, or storage is unavailable. */
export function readLastBulkReturnPool(shelterCode: string, user: string): string | null {
	if (!shelterCode || !user || typeof localStorage === 'undefined') return null;
	try {
		return localStorage.getItem(lastBulkReturnPoolKey(shelterCode, user));
	} catch {
		return null;
	}
}

/** Remember the pool for this shelter and user; silently skipped when storage is unavailable. */
export function writeLastBulkReturnPool(shelterCode: string, user: string, poolId: string): void {
	if (!shelterCode || !user || !poolId || typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(lastBulkReturnPoolKey(shelterCode, user), poolId);
	} catch {
		/* ignore quota / private mode */
	}
}
