/**
 * Expected write access to people-plane docs, copied from the binding spec:
 * docs/prd/role-permission-matrix.md §2 (Health & Screening Policy) and §3 (Action Matrix),
 * rows "Evacuee / Household", "Triage & Screening" and "Medical Record".
 * When the matrix changes, change this file in the same PR.
 */

/** Shelter-scoped capabilities (`src/lib/auth/roles.ts`), held as `{code}:{role}`. */
export const SHELTER_ROLES = [
	'shelter_manager',
	'registration_staff',
	'triage_staff',
	'medical_staff',
	'kitchen_staff',
	'supply_coordinator',
	'warehouse_staff',
	'donation_staff',
	'volunteer_coordinator',
	'security_officer',
	'facility_staff',
	'distribution_staff',
	'kiosk_staff',
	'pr_staff'
] as const;

export type ShelterRole = (typeof SHELTER_ROLES)[number];

export const PEOPLE_DOC_TYPES = ['evacuee', 'household', 'screening', 'medical'] as const;

export type PeopleDocType = (typeof PEOPLE_DOC_TYPES)[number];

/** Roles that may write each doc type in their own shelter. `system_admin` may write all. */
export const WRITERS: Record<PeopleDocType, readonly ShelterRole[]> = {
	evacuee: ['shelter_manager', 'registration_staff'],
	household: ['shelter_manager', 'registration_staff'],
	screening: ['shelter_manager', 'registration_staff', 'triage_staff', 'medical_staff'],
	medical: ['shelter_manager', 'medical_staff']
};

/**
 * Known gaps between the spec and what CouchDB enforces today. Each entry turns the test
 * into an expected failure (`test.fail`), so the suite stays green while the gap is open and
 * goes red the day it is fixed — then delete the entry.
 */
export const KNOWN_GAPS: Partial<Record<PeopleDocType, string>> = {
	// validate_doc_update checks no role for these types: any member of the shelter writes them.
	evacuee: 'https://github.com/r202-coe-psu/tent/issues/834',
	household: 'https://github.com/r202-coe-psu/tent/issues/834',
	screening: 'https://github.com/r202-coe-psu/tent/issues/834',
	medical: 'https://github.com/r202-coe-psu/tent/issues/834'
};
