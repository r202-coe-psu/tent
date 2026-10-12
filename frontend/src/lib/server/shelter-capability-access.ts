import {
	canManageInShelters,
	hasCapabilityAnywhere,
	isSystemAdmin,
	shelterCodesWithCapability
} from '$lib/auth/roles';
import { readSessionUserCtx, ServiceError } from '$lib/server/couch-admin';

/** Authenticated caller plus the shelters they may manage for one capability set. */
export interface ScopedCaller {
	name: string;
	roles: string[];
	isSA: boolean;
	/** Shelters the caller may manage for this capability set; `null` = every shelter (SA). */
	scope: string[] | null;
	capabilities: readonly string[];
}

/** Resolve the `_session` caller; 401 when anonymous, 403 when the capability is held nowhere. */
export async function requireShelterCapabilityCaller(
	cookie: string | null,
	capabilities: readonly string[]
): Promise<ScopedCaller> {
	const { name, roles } = await readSessionUserCtx(cookie);
	if (!name) throw new ServiceError('UNAUTHENTICATED', 'Authentication required');
	if (!hasCapabilityAnywhere(roles, capabilities)) {
		throw new ServiceError('FORBIDDEN', 'Requires a shelter capability for this operation');
	}
	return {
		name,
		roles,
		isSA: isSystemAdmin(roles),
		scope: shelterCodesWithCapability(roles, capabilities),
		capabilities
	};
}

/** True when the caller may manage every one of `shelterCodes` (SA always; empty list never). */
export function callerCanManage(caller: ScopedCaller, shelterCodes: readonly string[]): boolean {
	return canManageInShelters(caller.roles, shelterCodes, caller.capabilities);
}

/** Narrow an optional `?shelter_code=` filter to the caller's scope (`null` = no filter, SA). */
export function scopedShelterFilter(
	caller: ScopedCaller,
	requested: string | null
): string[] | null {
	if (!requested) return caller.scope;
	return caller.scope === null || caller.scope.includes(requested) ? [requested] : [];
}
