type KioskShelterConfig = {
	feature_flags?: {
		kiosk_phone_check_in_enabled?: unknown;
		kiosk_thaid_check_in_enabled?: unknown;
		kiosk_walk_in_registration_enabled?: unknown;
		allow_pets?: unknown;
	} | null;
} | null;

/** Shelter-level toggle contract (FR-KPT-01/02/10/11): missing or non-true values stay disabled. */
export function isKioskPhoneCheckInEnabled(shelter: KioskShelterConfig): boolean {
	return shelter?.feature_flags?.kiosk_phone_check_in_enabled === true;
}

/** Shelter-level ThaiD toggle (FR-KTD-13/44): missing or non-true values stay disabled. */
export function isKioskThaidCheckInEnabled(shelter: KioskShelterConfig): boolean {
	return shelter?.feature_flags?.kiosk_thaid_check_in_enabled === true;
}

export function isKioskWalkInRegistrationEnabled(shelter: KioskShelterConfig): boolean {
	return shelter?.feature_flags?.kiosk_walk_in_registration_enabled === true;
}

/** FR-KUC-12a: the kiosk claim brings pets only to a shelter that takes them; non-true stays off. */
export function isKioskPetClaimEnabled(shelter: KioskShelterConfig): boolean {
	return shelter?.feature_flags?.allow_pets === true;
}
