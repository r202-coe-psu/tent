/**
 * Device-scoped memory of whether the staff desktop sidebar is collapsed. One choice for every
 * staff sidebar (back-office, system-management, and SA/SM on /portal, /me, /onsite) and every
 * role (#1517): the first visit starts collapsed, after that each page follows the latest toggle.
 * UI-only convenience: every access is guarded, so an unavailable storage just means the sidebar
 * starts collapsed on every load.
 */

/** localStorage key; shared by every user on this device. */
export const SIDEBAR_COLLAPSED_KEY = 'staff:sidebar-collapsed';

/** Collapsed unless the user explicitly left it expanded; also the fallback when storage fails. */
export function readSidebarCollapsed(): boolean {
	if (typeof localStorage === 'undefined') return true;
	try {
		return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) !== 'expanded';
	} catch {
		return true;
	}
}

/** Remember the sidebar state; silently skipped when storage is unavailable. */
export function writeSidebarCollapsed(collapsed: boolean): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? 'collapsed' : 'expanded');
	} catch {
		/* ignore quota / private mode */
	}
}
