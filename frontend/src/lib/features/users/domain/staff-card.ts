import {
	SHELTER_CAPABILITIES,
	SHELTER_MANAGER,
	capabilitiesForShelter,
	hasShelterScope,
	isSystemAdmin,
	roleDisplayLabel
} from '$lib/auth/roles';
import { extractScanCode } from '$lib/utils/scan-code';

export const STAFF_TOKEN_PREFIX = 'TKT-STF-';
export const STAFF_TOKEN_HASH_PREFIX = 'TKT-STF-HASH-';
export const STAFF_TOKEN_RANDOM_BYTES = 16;

export function formatStaffToken(bytes: Uint8Array): string {
	if (bytes.length !== STAFF_TOKEN_RANDOM_BYTES) {
		throw new RangeError(
			`staff token needs ${STAFF_TOKEN_RANDOM_BYTES} bytes, got ${bytes.length}`
		);
	}
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
	return STAFF_TOKEN_PREFIX + hex.toUpperCase();
}

export function isValidStaffTokenHash(v: unknown): v is string {
	return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
}

/** The card QR carries the hash, never the plaintext token: the hash itself is the bearer. */
export function staffCardPayloadFromHash(hash: string): string {
	return STAFF_TOKEN_HASH_PREFIX + hash;
}

export function parseStaffCardPayload(raw: string): { hash: string } | null {
	const code = extractScanCode(raw);
	if (!code.toUpperCase().startsWith(STAFF_TOKEN_HASH_PREFIX)) return null;
	const hash = code.slice(STAFF_TOKEN_HASH_PREFIX.length).toLowerCase();
	return isValidStaffTokenHash(hash) ? { hash } : null;
}

const STAFF_RECIPIENT_PREFIX = 'user:';

export function staffRecipientId(name: string): string {
	return STAFF_RECIPIENT_PREFIX + name;
}

export function userNameFromStaffRecipientId(id: string): string | null {
	if (!id.startsWith(STAFF_RECIPIENT_PREFIX)) return null;
	return id.slice(STAFF_RECIPIENT_PREFIX.length) || null;
}

const CENTRAL_ADMIN_LABEL = 'ผู้ดูแลระบบส่วนกลาง';
const GENERIC_STAFF_LABEL = 'เจ้าหน้าที่';

export function staffCardRoleLabel(roles: readonly string[], shelterCode: string | null): string {
	if (isSystemAdmin(roles)) return CENTRAL_ADMIN_LABEL;
	if (!shelterCode || !hasShelterScope(roles, shelterCode)) return GENERIC_STAFF_LABEL;
	const held = new Set<string>(capabilitiesForShelter(roles, shelterCode));
	const ordered = [
		...(held.has(SHELTER_MANAGER) ? [SHELTER_MANAGER] : []),
		...SHELTER_CAPABILITIES.filter((cap) => cap !== SHELTER_MANAGER && held.has(cap))
	];
	return ordered.length > 0 ? ordered.map(roleDisplayLabel).join(' · ') : GENERIC_STAFF_LABEL;
}
