import { SHELTER_MANAGER, SYSTEM_ADMIN } from '$lib/auth/roles';
import type { PrintJobSource } from './print-job.schema';

/**
 * Where a print job came from. `walk_in` / `evacuee_qr` are the public request sources;
 * `test` is the back-office-only test print and is never accepted by the public request schema.
 */
export type PrintSource = PrintJobSource | 'test';

const REGISTRATION_STAFF = 'registration_staff';

/**
 * FR-29a — who may print, by job source. Single source of truth: the BFF checks it directly and
 * the CouchDB validate_doc_update is generated from this same table, so it is plain string
 * matching on compound roles (`{CODE}:{capability}`), never legacy flat roles.
 */
export const PRINT_SOURCE_CAPABILITIES: Readonly<Record<PrintSource, readonly string[]>> = {
	walk_in: [REGISTRATION_STAFF, SHELTER_MANAGER],
	evacuee_qr: [REGISTRATION_STAFF, SHELTER_MANAGER],
	test: [SHELTER_MANAGER]
};

function isPrintSource(source: string): source is PrintSource {
	return Object.hasOwn(PRINT_SOURCE_CAPABILITIES, source);
}

/** Exact compound role strings that may print `source` in a shelter, e.g. `SH001:shelter_manager`. */
export function printRolesFor(shelterCode: string, source: string): string[] {
	if (!isPrintSource(source)) return [];
	const code = shelterCode.toUpperCase();
	return PRINT_SOURCE_CAPABILITIES[source].map((capability) => `${code}:${capability}`);
}

/**
 * True iff the roles include `system_admin`, or `shelter:{CODE}` plus one of the compound roles
 * from {@link printRolesFor}. Unknown source, flat roles and `_admin` alone are denied.
 */
export function canPrintSource(
	roles: readonly string[],
	shelterCode: string,
	source: string
): boolean {
	if (!isPrintSource(source)) return false;
	if (roles.includes(SYSTEM_ADMIN)) return true;
	const allowed = printRolesFor(shelterCode, source);
	if (!roles.includes(`shelter:${shelterCode.toUpperCase()}`)) return false;
	return allowed.some((role) => roles.includes(role));
}
