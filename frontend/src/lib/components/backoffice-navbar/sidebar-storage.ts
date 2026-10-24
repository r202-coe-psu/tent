/**
 * Device-scoped memory of whether the back-office desktop sidebar is collapsed. UI-only
 * convenience: every access is guarded, so an unavailable storage just means the sidebar starts
 * collapsed on every load.
 */

/** localStorage key; shared by every user on this device. */
export const BACKOFFICE_SIDEBAR_KEY = 'backoffice:sidebar-collapsed';

/** Collapsed unless the user explicitly left it expanded; also the fallback when storage fails. */
export function readBackofficeSidebarCollapsed(): boolean {
	if (typeof localStorage === 'undefined') return true;
	try {
		return localStorage.getItem(BACKOFFICE_SIDEBAR_KEY) !== 'expanded';
	} catch {
		return true;
	}
}

/** Remember the sidebar state; silently skipped when storage is unavailable. */
export function writeBackofficeSidebarCollapsed(collapsed: boolean): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(BACKOFFICE_SIDEBAR_KEY, collapsed ? 'collapsed' : 'expanded');
	} catch {
		/* ignore quota / private mode */
	}
}
