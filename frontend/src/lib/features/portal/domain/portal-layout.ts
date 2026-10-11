/**
 * Adaptive density for the portal home (`/portal`). Pure: no I/O, no Svelte.
 *
 *  - `focused`: at most {@link PORTAL_FOCUSED_MAX_DEPARTMENTS} visible departments → one large-tile
 *    card per department (the original layout, unchanged for those users).
 *  - `overview`: three or more visible departments → sticky department chip bar, compact rows in a
 *    card grid, or a single selected department in the large-tile layout.
 *
 * Department order is never changed here; `filterPortalDepartments` only narrows the list.
 */
import type { PortalDepartmentId, PortalDepartmentView } from './portal-menu';

/** Largest number of visible departments that still renders the focused layout. */
export const PORTAL_FOCUSED_MAX_DEPARTMENTS = 2;

export type PortalLayoutMode = 'focused' | 'overview';

/** Chip id for "every department". */
export const PORTAL_DEPARTMENT_ALL = 'all';

/** The department chip the user selected: every department, or one visible department. */
export type PortalDepartmentSelection = typeof PORTAL_DEPARTMENT_ALL | PortalDepartmentId;

/** `focused` when ≤ 2 departments are visible, `overview` when ≥ 3. */
export function portalLayoutMode(views: readonly PortalDepartmentView[]): PortalLayoutMode {
	return views.length > PORTAL_FOCUSED_MAX_DEPARTMENTS ? 'overview' : 'focused';
}

/**
 * Effective selection for a stored/picked id. `'all'`, an unknown id, a department that is not
 * visible for the current roles, or a missing value all fall back to `'all'`.
 */
export function resolvePortalDepartmentSelection(
	views: readonly PortalDepartmentView[],
	selected: string | null | undefined
): PortalDepartmentSelection {
	if (!selected || selected === PORTAL_DEPARTMENT_ALL) return PORTAL_DEPARTMENT_ALL;
	const visible = views.some((view) => view.id === selected);
	return visible ? (selected as PortalDepartmentId) : PORTAL_DEPARTMENT_ALL;
}

/** The views to render for a selection: all of them, or only the selected department. */
export function filterPortalDepartments(
	views: readonly PortalDepartmentView[],
	selected: string | null | undefined
): PortalDepartmentView[] {
	const selection = resolvePortalDepartmentSelection(views, selected);
	if (selection === PORTAL_DEPARTMENT_ALL) return [...views];
	return views.filter((view) => view.id === selection);
}
