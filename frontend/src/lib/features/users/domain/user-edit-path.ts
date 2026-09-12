/** List route for the current staff plane (portal SA vs shelter back-office). */
export function usersListBaseFromPathname(pathname: string): string {
	return pathname.includes('/portal/system-management')
		? '/portal/system-management/users'
		: '/back-office/users';
}

export function userEditHref(listBase: string, name: string, from?: string): string {
	const path = `${listBase}/${encodeURIComponent(name)}`;
	if (!from) return path;
	return `${path}?from=${encodeURIComponent(from)}`;
}

/** Same-origin relative path only — blocks protocol-relative and external URLs. */
export function safeReturnPath(from: string | null | undefined, fallback: string): string {
	if (!from || !from.startsWith('/') || from.startsWith('//') || from.includes('://')) {
		return fallback;
	}
	return from;
}

/** When the list is embedded (shelter form), mark the users pane so cancel/save can restore it. */
export function withUsersView(pathname: string, search: string): string {
	const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
	if (!pathname.endsWith('/users')) {
		params.set('view', 'users');
	}
	const qs = params.toString();
	return qs ? `${pathname}?${qs}` : pathname;
}
