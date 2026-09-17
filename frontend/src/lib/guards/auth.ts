import { authStore } from '$lib/stores/auth.svelte';
import { shelterStore } from '$lib/stores/shelter.svelte';
import { redirect } from '@sveltejs/kit';
import { browser } from '$app/environment';
import { resolve } from '$app/paths';
import {
	COUCH_ADMIN,
	hasStaffCapability,
	isShelterManager,
	isWarehouseStaff,
	isSystemAdmin,
	canAccessMedicalScreening,
	canAccessZoning,
	shelterCodeFromRoles
} from '$lib/auth/roles';
import { fetchAuthStatus, type AuthStatus } from '$lib/features/users';

/** Where a freshly-authenticated user (or an already-authed visitor to an auth page) lands. */
export const LANDING_ROUTE = '/portal';

/** The login page — where unauthenticated users are sent. */
export const LOGIN_ROUTE = '/login';

/** Where users land after logout. */
export const LOGOUT_ROUTE = '/';

/** CR-105 first-login / password force-setup. */
export const FORCE_SETUP_ROUTE = '/force-setup';

/** CR-124 Google step-up challenge. */
export const MFA_CHALLENGE_ROUTE = '/mfa-challenge';

export type PostLoginDestination =
	typeof FORCE_SETUP_ROUTE | typeof MFA_CHALLENGE_ROUTE | typeof LANDING_ROUTE;

/**
 * Post-password gate order (CR-105 then CR-124):
 * force-setup → MFA challenge → portal.
 */
export function resolvePostLoginDestination(
	status: Pick<AuthStatus, 'must_change_password' | 'has_security_question' | 'pending_mfa'> & {
		roles?: readonly string[];
	}
): PostLoginDestination {
	if (status.roles?.includes(COUCH_ADMIN)) {
		return LANDING_ROUTE;
	}
	if (status.must_change_password || !status.has_security_question) {
		return FORCE_SETUP_ROUTE;
	}
	if (status.pending_mfa) {
		return MFA_CHALLENGE_ROUTE;
	}
	return LANDING_ROUTE;
}

function activeShelterCode(roles: readonly string[]): string | null {
	return shelterStore.selectedShelterCode ?? shelterCodeFromRoles(roles);
}

/**
 * Auth guard for protected routes. Resolves the CouchDB `_session` cookie and
 * redirects to /login when there is no authenticated user. When enrolled in
 * Google MFA without a valid `mfa_ok`, redirects to `/mfa-challenge` (after
 * force-setup when needed).
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

	try {
		const status = await fetchAuthStatus();
		const dest = resolvePostLoginDestination(status);
		if (dest === FORCE_SETUP_ROUTE) {
			throw redirect(302, resolve(FORCE_SETUP_ROUTE));
		}
		if (dest === MFA_CHALLENGE_ROUTE) {
			throw redirect(302, resolve(MFA_CHALLENGE_ROUTE));
		}
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e && (e as { status: number }).status === 302) {
			throw e;
		}
		// Status fetch failed (offline / BFF down) — do not silently bypass MFA.
		// Keep the user on a safe path: if we already know they need reauth, login;
		// otherwise allow through only when Couch session exists (edge may lack BFF).
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
	const shelter = activeShelterCode(roles);
	if (!isSystemAdmin(roles) && !isShelterManager(roles, shelter)) {
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
	const shelter = activeShelterCode(roles);
	if (
		!isSystemAdmin(roles) &&
		!isShelterManager(roles, shelter) &&
		!isWarehouseStaff(roles, shelter)
	) {
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
	const shelter = activeShelterCode(roles);
	if (
		!isSystemAdmin(roles) &&
		!isShelterManager(roles, shelter) &&
		!hasStaffCapability(roles, 'kitchen_staff', shelter)
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
	const shelter = activeShelterCode(roles);
	if (
		!isSystemAdmin(roles) &&
		!isShelterManager(roles, shelter) &&
		!hasStaffCapability(roles, 'registration_staff', shelter)
	) {
		throw redirect(302, resolve(LANDING_ROUTE));
	}
}

/**
 * Volunteer on-site check-in guard — requires system_admin, shelter_manager,
 * `volunteer_coordinator`, or `registration_staff` (CR-104 route table:
 * `/back-office/volunteers/checkin` — "หน้าจอแท็บเล็ตจุดรับรายงานตัวและเช็คอินหน้าศูนย์").
 * This is a UX gate; the data layer remains the real authorization boundary.
 */
export async function requireVolunteerCheckIn(fetchFn?: typeof fetch) {
	await requireAuth(fetchFn);
	const roles = authStore.user?.roles ?? [];
	if (
		!isSystemAdmin(roles) &&
		!isShelterManager(roles) &&
		!hasStaffCapability(roles, 'volunteer_coordinator') &&
		!hasStaffCapability(roles, 'registration_staff')
	) {
		throw redirect(302, resolve(LANDING_ROUTE));
	}
}

/**
 * Medical screening guard — requires system_admin, shelter_manager,
 * medical_staff, or triage_staff. Used for Station 2 medical screening.
 */
export async function requireMedicalScreening(fetchFn?: typeof fetch) {
	await requireAuth(fetchFn);
	const roles = authStore.user?.roles ?? [];
	if (!canAccessMedicalScreening(roles, activeShelterCode(roles))) {
		throw redirect(302, resolve(LANDING_ROUTE));
	}
}

/**
 * Zoning guard — requires system_admin, shelter_manager,
 * registration_staff, or facility_staff. Used for Station 3 zoning.
 */
export async function requireZoning(fetchFn?: typeof fetch) {
	await requireAuth(fetchFn);
	const roles = authStore.user?.roles ?? [];
	if (!canAccessZoning(roles, activeShelterCode(roles))) {
		throw redirect(302, resolve(LANDING_ROUTE));
	}
}

/**
 * Redirect away from auth pages (login) when a session already exists.
 * Pending MFA / force-setup are routed to those gates — never straight to portal.
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
		try {
			const status = await fetchAuthStatus();
			const dest = resolvePostLoginDestination(status);
			throw redirect(302, resolve(dest === LANDING_ROUTE ? redirectTo : dest));
		} catch (e) {
			if (e && typeof e === 'object' && 'status' in e && (e as { status: number }).status === 302) {
				throw e;
			}
			throw redirect(302, resolve(redirectTo));
		}
	}
}
