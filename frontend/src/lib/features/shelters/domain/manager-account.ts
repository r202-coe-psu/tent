import { compoundCapabilityRole, shelterScopeRole, SHELTER_MANAGER } from '$lib/auth/roles';
import { normalizeThaiPhone } from '$lib/db/model';

export interface ManagerAccountSpec {
	name: string;
	password: string;
	display_name: string;
	phone: string;
	roles: string[];
}

/**
 * Login to auto-create for the shelter's centre manager (contact name + phone): username is the
 * phone, password is `{phone}Sh{digits of code}/` (e.g. `0812345678Sh001/`). Null when the contact
 * is incomplete or the phone is not a 10-digit mobile, so the shelter still saves without it.
 */
export function managerAccountSpec(
	code: string,
	contact: { name?: string | null; phone?: string | null } | null | undefined
): ManagerAccountSpec | null {
	const displayName = contact?.name?.trim() ?? '';
	const phone = normalizeThaiPhone(contact?.phone ?? '');
	if (!displayName || !/^0\d{9}$/.test(phone)) return null;
	const digits = code.replace(/\D/g, '');
	return {
		name: phone,
		password: `${phone}Sh${digits}/`,
		display_name: displayName,
		phone,
		roles: [shelterScopeRole(code), compoundCapabilityRole(code, SHELTER_MANAGER)]
	};
}
