import { isShelterManager, isSystemAdmin } from '$lib/auth/roles';

/**
 * Pages outside `/back-office` where a system admin or the shelter manager of the selected shelter
 * still gets the back-office sidebar, so they can reach any page they may open without
 * going back to the portal (#1517). `/system-management` keeps its own sidebar.
 */
const STAFF_SIDEBAR_PREFIXES = ['/portal', '/me', '/onsite'] as const;

function underPrefix(pathname: string, prefix: string): boolean {
	return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Does this user get the back-office sidebar on this page? Other roles see the page as before. */
export function showsStaffSidebar(
	pathname: string,
	roles: readonly string[],
	shelterCode?: string | null
): boolean {
	if (!STAFF_SIDEBAR_PREFIXES.some((prefix) => underPrefix(pathname, prefix))) return false;
	return isSystemAdmin(roles) || isShelterManager(roles, shelterCode);
}

/**
 * `/onsite` is a hands-on page for phones and tablets, and its sticky chrome starts at the very
 * top: the sidebar's own mobile bar would push it down, so phones keep the page as it was.
 */
export function showsStaffMobileBar(pathname: string): boolean {
	return !underPrefix(pathname, '/onsite');
}
