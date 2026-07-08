import { authStore } from '$lib/stores/auth.svelte';
import { redirect } from '@sveltejs/kit';
import { browser } from '$app/environment';
import { resolve } from '$app/paths';
import {
	hasStaffCapability,
	isShelterManager,
	isWarehouseStaff,
	isSystemAdmin
} from '$lib/auth/roles';

/** Where a freshly-authenticated user (or an already-authed visitor to an auth page) lands. */
export const LANDING_ROUTE = '/';

/** The login page — where unauthenticated and just-logged-out users are sent. */
export const LOGIN_ROUTE = '/login';

/**
 * Auth guard for protected routes. Resolves the CouchDB `_session` cookie and
 * redirects to /login when there is no authenticated user.
 *
 * @example
 * // src/routes/(protected)/+layout.ts
 * import { requireAuth } from '$lib/guards/auth';
 * export const load = async () => {
 *   await requireAuth();
 *   return {};
 * };
 */
export async function requireAuth(fetchFn?: typeof fetch) {
	if (!browser) return;

	await authStore.ensureInitialized(fetchFn);

	if (!authStore.isAuthenticated) {
		throw redirect(302, resolve(LOGIN_ROUTE));
	}
}

/**
 * Admin guard — requires a system admin (`system_admin` or the CouchDB `_admin`).
 * Redirects to / when authenticated but not an admin.
 */
export async function requireAdmin(fetchFn?: typeof fetch) {
	await requireAuth(fetchFn);
	if (!isSystemAdmin(authStore.user?.roles ?? [])) {
		throw redirect(302, resolve(LANDING_ROUTE));
	}
}

/**
 * Manager guard — requires a system admin OR a shelter_manager. Used by the
 * user-management page (the BFF is the real authorization gate; this is UX).
 */
export async function requireManager(fetchFn?: typeof fetch) {
	await requireAuth(fetchFn);
	const roles = authStore.user?.roles ?? [];
	if (!isSystemAdmin(roles) && !isShelterManager(roles)) {
		throw redirect(302, resolve(LANDING_ROUTE));
	}
}

/**
 * Warehouse guard — requires INVENTORY_WRITE_ROLES: system_admin, shelter_manager,
 * or warehouse_staff (role-permission-matrix.md §4). Redirects to / otherwise.
 */
export async function requireWarehouseAccess(fetchFn: typeof fetch = fetch) {
	await requireAuth(fetchFn);
	const roles = authStore.user?.roles ?? [];
	if (!isSystemAdmin(roles) && !isShelterManager(roles) && !isWarehouseStaff(roles)) {
		throw redirect(302, resolve(LANDING_ROUTE));
	}
}

/**
 * Kitchen guard — requires system_admin, shelter_manager, or the `kitchen_staff`
 * capability (CR-024). This is a UX gate; the data layer remains the real
 * authorization boundary. Redirects to / when authenticated but unauthorized.
 */
export async function requireKitchen(fetchFn?: typeof fetch) {
	await requireAuth(fetchFn);
	const roles = authStore.user?.roles ?? [];
	if (
		!isSystemAdmin(roles) &&
		!isShelterManager(roles) &&
		!hasStaffCapability(roles, 'kitchen_staff')
	) {
		throw redirect(302, resolve(LANDING_ROUTE));
	}
}

/**
 * Evacuee registration guard — requires system_admin, shelter_manager, or
 * the `registration_staff` capability. Used for PII surfaces (evacuee/
 * household CRUD) so only staff whose job is registration can reach them;
 * this is a UX gate, the data layer remains the real authorization boundary.
 * Not to be confused with the unrelated user-signup `register` feature.
 */
export async function requireEvacueeRegistration(fetchFn?: typeof fetch) {
	await requireAuth(fetchFn);
	const roles = authStore.user?.roles ?? [];
	if (
		!isSystemAdmin(roles) &&
		!isShelterManager(roles) &&
		!hasStaffCapability(roles, 'registration_staff')
	) {
		throw redirect(302, resolve(LANDING_ROUTE));
	}
}

/**
 * Redirect away from auth pages (login) when a session already exists.
 *
 * @example
 * // src/routes/login/+page.ts
 * import { redirectIfAuthenticated } from '$lib/guards/auth';
 * export const load = async () => {
 *   await redirectIfAuthenticated();
 *   return {};
 * };
 */
export async function redirectIfAuthenticated(
	redirectTo: typeof LANDING_ROUTE = LANDING_ROUTE,
	fetchFn?: typeof fetch
) {
	if (!browser) return;

	await authStore.ensureInitialized(fetchFn);

	// Allow the login page through when the sync session has expired, so the
	// user can re-authenticate even though a cached identity still exists.
	if (authStore.isAuthenticated && !authStore.needsReauth) {
		throw redirect(302, resolve(redirectTo));
	}
}
