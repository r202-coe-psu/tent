/**
 * Per-user memory of the department chip picked on `/portal`. UI-only convenience: every access
 * is guarded, so an unavailable or full storage (private window, blocked site data) just means the
 * choice is not remembered across reloads.
 */

/** localStorage key for one user's chip choice, e.g. `portal:dept-filter:alice`. */
export function portalDeptFilterKey(username: string): string {
	return `portal:dept-filter:${username}`;
}

/** The stored chip id for this user, or `null` when none is stored or storage is unavailable. */
export function readPortalDeptFilter(username: string): string | null {
	if (!username || typeof localStorage === 'undefined') return null;
	try {
		return localStorage.getItem(portalDeptFilterKey(username));
	} catch {
		return null;
	}
}

/** Remember the chip choice for this user; silently skipped when storage is unavailable. */
export function writePortalDeptFilter(username: string, selection: string): void {
	if (!username || typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(portalDeptFilterKey(username), selection);
	} catch {
		/* ignore quota / private mode */
	}
}
