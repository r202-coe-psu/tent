import { findMasterByCode } from '$lib/server/shelters.admin';
import { isThaidRegistrationEnabled } from '$lib/server/thaid-registration-gate';
import { isKioskThaidCheckInEnabled } from '../domain/kiosk-config';

/**
 * Gate for ThaiD kiosk check-in (FR-KTD-13): system ThaiD enabled in real mode AND the shelter's
 * `kiosk_thaid_check_in_enabled` flag on. Fails closed on any error (including an unreadable `config:app`) or missing shelter.
 */
export async function isKioskThaidCheckInAllowed(
	shelterCode: string,
	options: { shelter?: Awaited<ReturnType<typeof findMasterByCode>> } = {}
): Promise<boolean> {
	try {
		const system = await isThaidRegistrationEnabled({ onConfigError: 'deny' });
		if (system.enabled !== true || system.mode !== 'real') return false;
		// A caller that already holds the shelter passes it to avoid a second registry read.
		const shelter =
			options.shelter !== undefined ? options.shelter : await findMasterByCode(shelterCode);
		return isKioskThaidCheckInEnabled(shelter);
	} catch {
		return false;
	}
}
