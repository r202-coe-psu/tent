import { ServiceError } from '$lib/server/couch-admin';
import { SCANNER_MANAGER_CAPABILITIES } from '$lib/auth/roles';
import {
	callerCanManage,
	requireShelterCapabilityCaller,
	type ScopedCaller
} from '$lib/server/shelter-capability-access';
import { ScannerDeviceNotFoundError } from './device-credentials';

/** Resolve the caller of a scanner admin route: SA, or a shelter_manager of at least one shelter. */
export function requireScannerManager(request: Request): Promise<ScopedCaller> {
	return requireShelterCapabilityCaller(
		request.headers.get('cookie'),
		SCANNER_MANAGER_CAPABILITIES
	);
}

/** A device outside the caller's scope reads as missing (FR-SBO-04). */
export function assertDeviceInScope(caller: ScopedCaller, device: { shelter_code: string }): void {
	if (!callerCanManage(caller, [device.shelter_code])) throw new ScannerDeviceNotFoundError();
}

/** Creating for a shelter outside scope is 403 — the caller chose the shelter (FR-SBO-05). */
export function assertCanCreateFor(caller: ScopedCaller, shelterCode: string): void {
	if (!callerCanManage(caller, [shelterCode])) {
		throw new ServiceError('FORBIDDEN', 'Not a shelter_manager of this shelter');
	}
}
