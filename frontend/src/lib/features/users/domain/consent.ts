import { COUCH_ADMIN } from '$lib/auth/roles';

export const CURRENT_CONSENT_VERSION = '1.0';

export interface UserConsentStatus {
	agreed: boolean;
	agreed_at?: string | null;
	version?: string | null;
}

export interface ConsentUserTarget {
	roles?: readonly string[];
	personnel_type?: 'staff' | 'volunteer' | null;
	consent?: UserConsentStatus | null;
}

/**
 * Evaluates whether an authenticated user must agree to the PDPA and Non-disclosure
 * agreement before accessing operational features.
 */
export function requiresConsent(
	user: ConsentUserTarget,
	currentVersion = CURRENT_CONSENT_VERSION
): boolean {
	if (user.roles?.includes(COUCH_ADMIN)) {
		return false;
	}

	if (user.consent?.agreed && user.consent?.version === currentVersion) {
		return false;
	}

	return true;
}
