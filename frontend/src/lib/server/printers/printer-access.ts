import { PRINTER_MANAGER_CAPABILITIES } from '$lib/auth/roles';
import { ServiceError } from '$lib/server/couch-admin';
import {
	callerCanManage,
	requireShelterCapabilityCaller,
	type ScopedCaller
} from '$lib/server/shelter-capability-access';

/** Resolve the caller of a printer admin route: SA, or a shelter_manager of at least one shelter (O-3). */
export function requirePrinterManager(request: Request): Promise<ScopedCaller> {
	return requireShelterCapabilityCaller(
		request.headers.get('cookie'),
		PRINTER_MANAGER_CAPABILITIES
	);
}

/** Creating for a shelter outside scope is 403 — the caller chose the shelter. */
export function assertCanCreatePrinterFor(caller: ScopedCaller, shelterCode: string): void {
	if (!callerCanManage(caller, [shelterCode])) {
		throw new ServiceError('FORBIDDEN', 'Not a shelter_manager of this shelter');
	}
}
