type KioskShelterConfig = {
	feature_flags?: { kiosk_phone_check_in_enabled?: unknown } | null;
} | null;

/** Shelter-level toggle contract (FR-KPT-01/02/10/11): missing or non-true values stay disabled. */
export function isKioskPhoneCheckInEnabled(shelter: KioskShelterConfig): boolean {
	return shelter?.feature_flags?.kiosk_phone_check_in_enabled === true;
}
