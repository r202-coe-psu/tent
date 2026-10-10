import { findMasterByCode } from '$lib/server/shelters.admin';
import { isThaidRegistrationEnabled } from '$lib/server/thaid-registration-gate';
import { isKioskThaidCheckInEnabled } from '../domain/kiosk-config';

/**
 * Gate for ThaiD kiosk check-in (FR-KTD-13): system ThaiD enabled in real mode AND the shelter's
 * `kiosk_thaid_check_in_enabled` flag on. Fails closed on any error or missing shelter.
 */
export async function isKioskThaidCheckInAllowed(shelterCode: string): Promise<boolean> {
	try {
		const system = await isThaidRegistrationEnabled();
		if (system.enabled !== true || system.mode !== 'real') return false;
		const shelter = await findMasterByCode(shelterCode);
		return isKioskThaidCheckInEnabled(shelter);
	} catch {
		return false;
	}
}
