/**
 * Public API of the `locations` feature — Thailand province/district/subdistrict
 * reference data in the `registry` database (CR-037). Cross-feature and route
 * code (BFF handlers, seed script) import ONLY from here.
 */

// Domain — persisted doc shapes + flat record
export type {
	ProvinceDoc,
	DistrictDoc,
	SubdistrictDoc,
	LocationDoc,
	LocationRow
} from './domain/location';

// Domain — constants, id helpers, factories, guards, schemas
export {
	LOCATION_DB,
	LOCATION_SCHEMA_V,
	PROVINCE_TYPE,
	DISTRICT_TYPE,
	SUBDISTRICT_TYPE,
	provinceDocId,
	districtDocId,
	subdistrictDocId,
	provinceDocSchema,
	districtDocSchema,
	subdistrictDocSchema,
	isProvinceDoc,
	isDistrictDoc,
	isSubdistrictDoc,
	buildLocationDocs,
	makeProvinceDoc,
	makeDistrictDoc,
	makeSubdistrictDoc
} from './domain/location';

// Application — TanStack Query hooks for the location manager UI
export {
	locationKeys,
	useProvinces,
	useDistricts,
	useSubdistricts,
	useCreateProvince,
	useCreateDistrict,
	useCreateSubdistrict,
	useUpdateZipcode,
	useDeleteLocation,
	type SubdistrictEntry
} from './application/queries';

// UI
export { default as LocationManager } from './ui/location-manager.svelte';
