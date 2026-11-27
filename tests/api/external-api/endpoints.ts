/**
 * The keyed external plane, copied from the binding spec: docs/data/api-contract.md §5.1
 * (`/external/v1`, CR-062; M2 routes removed by CR-154). Cache-Control values are the ones the
 * router sets (backend/apiapp/modules/external/router.py). When §5.1 changes, change this file
 * in the same PR.
 *
 * The partner plane (`/external/*` + OAuth2 JWT, §5.3, EXT-001…012) is a different plane with
 * its own e2e: frontend/e2e/partner-api.test.ts.
 */

export interface KeyedEndpoint {
	name: string;
	method: 'GET' | 'POST';
	/** Path for the seeded shelter `code`. */
	path: (code: string) => string;
	body?: unknown;
	/** Expected `Cache-Control` of a successful answer; `null` when the router sets none. */
	cacheControl: string | null;
}

export const KEYED_ENDPOINTS: readonly KeyedEndpoint[] = [
	{
		name: 'shelter detail',
		method: 'GET',
		path: (code) => `/external/v1/shelters/${encodeURIComponent(code)}`,
		cacheControl: 'public, max-age=600'
	},
	{
		name: 'needs',
		method: 'GET',
		path: () => '/external/v1/needs',
		cacheControl: 'public, max-age=600'
	},
	{
		name: 'occupant search',
		method: 'POST',
		path: () => '/external/v1/occupants',
		// A name nobody is registered under: the gate is under test, not the search.
		body: { search: 'ไม่มีชื่อนี้ PERMTEST' },
		cacheControl: 'no-store'
	},
	{
		name: 'announcements',
		method: 'GET',
		path: () => '/external/v1/announcements',
		cacheControl: null
	},
	{
		name: 'FAQ config',
		method: 'GET',
		path: () => '/external/v1/config/faqs',
		cacheControl: 'public, max-age=60'
	}
];

/**
 * Fields an `/external/v1/occupants` result may carry: `ExternalSearchResult` in
 * backend/apiapp/modules/evacuee/schemas.py. The legacy plane returns the whole national ID on
 * purpose (CR-257 D-6); anything outside this list — medical, screening, phone, birth date —
 * is a leak.
 */
export const OCCUPANT_RESULT_FIELDS = [
	'name',
	'status',
	'national_id',
	'gender',
	'shelter_name',
	'shelter_address',
	'origin_address',
	'checked_in_at',
	'shelter_status',
	'family_members',
	'care_zone',
	'zone_name'
] as const;

/** Fields of one `family_members[]` entry (`FamilyMember`). */
export const FAMILY_MEMBER_FIELDS = ['name', 'status', 'shelter_name', 'shelter_status'] as const;

/** Fields of one shelter zone on this plane: no `code` / `status` / `present` (CR-254 D3). */
export const SHELTER_ZONE_FIELDS = ['name', 'type', 'capacity', 'area_m2'] as const;
