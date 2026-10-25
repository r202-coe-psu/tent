/**
 * Device-scoped memory of whether a staff desktop sidebar is collapsed. UI-only convenience:
 * every access is guarded, so an unavailable storage just means the sidebar starts collapsed on
 * every load.
 */

/** localStorage key per sidebar; shared by every user on this device. */
export const SIDEBAR_COLLAPSED_KEYS = {
	backoffice: 'backoffice:sidebar-collapsed',
	systemManagement: 'system-management:sidebar-collapsed'
} as const;

export type SidebarCollapsedKey =
	(typeof SIDEBAR_COLLAPSED_KEYS)[keyof typeof SIDEBAR_COLLAPSED_KEYS];

/** Collapsed unless the user explicitly left it expanded; also the fallback when storage fails. */
export function readSidebarCollapsed(key: SidebarCollapsedKey): boolean {
	if (typeof localStorage === 'undefined') return true;
	try {
		return localStorage.getItem(key) !== 'expanded';
	} catch {
		return true;
	}
}

/** Remember the sidebar state; silently skipped when storage is unavailable. */
export function writeSidebarCollapsed(key: SidebarCollapsedKey, collapsed: boolean): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(key, collapsed ? 'collapsed' : 'expanded');
	} catch {
		/* ignore quota / private mode */
	}
}
