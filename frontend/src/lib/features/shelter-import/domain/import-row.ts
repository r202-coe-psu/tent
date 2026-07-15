import { z } from 'zod';
import { createShelterSchema } from '$lib/features/shelters/server';
import { AREA_TYPE_CHOICES, H, OPERATION_STATUS_CHOICES, PROJECT_LEVEL_CHOICES } from './columns';
import type { EnumChoice, MasterColumn } from './columns';

/**
 * Pure mapping + validation for one Excel row → a shelter create payload
 * (CR-039). No I/O, no Svelte: master-data lookups are injected so the whole
 * module stays isomorphic and unit-testable.
 *
 * `validateRow` resolves enum/master-data labels to codes, coerces numbers,
 * fills the shelter sub-objects the form leaves empty (facilities / common_areas
 * / utilities / risk / zones), then runs `createShelterSchema` as the final
 * gate. Errors carry the Thai column header so the UI can point at the cell.
 */

/** A parsed spreadsheet row: header text → trimmed cell string. */
export type RawRow = Record<string, string>;

export interface RowFieldError {
	column: string;
	message: string;
}

export type RowStatus = 'created' | 'validation_error' | 'server_error';

/** Shelter create payload — inferred from the shared schema (no duplicate type). */
export type ShelterInput = z.infer<typeof createShelterSchema>;

export interface RowValidation {
	/** 1-based data row number (excludes the header row). */
	row: number;
	name: string | null;
	ok: boolean;
	/** present when `ok` — the parsed, ready-to-POST payload. */
	shelter?: ShelterInput;
	errors: RowFieldError[];
}

/** label → code map + the set of valid codes, for one master_data list. */
export interface MasterLookup {
	byLabel: Map<string, string>;
	codes: Set<string>;
}

export type Lookups = Record<MasterColumn, MasterLookup>;

/** Build a {@link MasterLookup} from a master_data items array. Pure. */
export function buildMasterLookup(items: readonly { code: string; label: string }[]): MasterLookup {
	const byLabel = new Map<string, string>();
	const codes = new Set<string>();
	for (const it of items) {
		byLabel.set(it.label.trim(), it.code);
		codes.add(it.code);
	}
	return { byLabel, codes };
}

/** An empty lookup pair — for tests / when master data is unavailable. */
export function emptyLookups(): Lookups {
	return {
		municipality_zone: { byLabel: new Map(), codes: new Set() },
		community: { byLabel: new Map(), codes: new Set() }
	};
}

function cell(raw: RawRow, header: string): string {
	return (raw[header] ?? '').trim();
}

/** '' → null, else the trimmed string. */
function strOrNull(v: string): string | null {
	return v === '' ? null : v;
}

/** '' → undefined (so a nullish numeric field stays unset instead of coercing to 0). */
function numOrUndef(v: string): string | undefined {
	return v === '' ? undefined : v;
}

/** The Thai part before " (" — so "เตรียมพร้อม (Standby)" also matches "เตรียมพร้อม". */
function labelBase(label: string): string {
	const i = label.indexOf(' (');
	return (i === -1 ? label : label.slice(0, i)).trim();
}

function resolveEnum(
	value: string,
	choices: readonly EnumChoice[],
	header: string
): { value?: string; error?: RowFieldError } {
	if (value === '') return { value: undefined };
	const match = choices.find(
		(c) => c.value === value || c.label === value || labelBase(c.label) === value
	);
	if (match) return { value: match.value };
	return {
		error: {
			column: header,
			message: `ค่าต้องเป็นหนึ่งใน: ${choices.map((c) => c.label).join(', ')}`
		}
	};
}

function resolveMaster(
	value: string,
	lookup: MasterLookup,
	header: string
): { value: string | null; error?: RowFieldError } {
	if (value === '') return { value: null };
	if (lookup.codes.has(value)) return { value };
	const code = lookup.byLabel.get(value);
	if (code) return { value: code };
	return { value: null, error: { column: header, message: `ไม่พบ "${value}" ในรายการ${header}` } };
}

/** Map a Zod issue path to its Thai column header (nested paths joined with "."). */
const PATH_TO_HEADER: Record<string, string> = {
	name: H.name,
	operation_status: H.operation_status,
	project_level: H.project_level,
	'location.address': H.address,
	'location.lat': H.lat,
	'location.lng': H.lng,
	municipality_zone: H.municipality_zone,
	community: H.community,
	address_no: H.address_no,
	village_no: H.village_no,
	province: H.province,
	district: H.district,
	subdistrict: H.subdistrict,
	postal_code: H.postal_code,
	'contact.name': H.contact_name,
	'contact.phone': H.contact_phone,
	capacity: H.capacity,
	area_m2: H.area_m2,
	area_type: H.area_type
};

/** Validate + map a single raw row. `row` is the 1-based data row number. */
export function validateRow(raw: RawRow, row: number, lookups: Lookups): RowValidation {
	const errors: RowFieldError[] = [];
	const nameCell = cell(raw, H.name);
	const name = nameCell === '' ? null : nameCell;

	const status = resolveEnum(
		cell(raw, H.operation_status),
		OPERATION_STATUS_CHOICES,
		H.operation_status
	);
	if (status.error) errors.push(status.error);
	const level = resolveEnum(cell(raw, H.project_level), PROJECT_LEVEL_CHOICES, H.project_level);
	if (level.error) errors.push(level.error);
	const areaType = resolveEnum(cell(raw, H.area_type), AREA_TYPE_CHOICES, H.area_type);
	if (areaType.error) errors.push(areaType.error);

	const zone = resolveMaster(
		cell(raw, H.municipality_zone),
		lookups.municipality_zone,
		H.municipality_zone
	);
	if (zone.error) errors.push(zone.error);
	const community = resolveMaster(cell(raw, H.community), lookups.community, H.community);
	if (community.error) errors.push(community.error);

	const capacityCell = cell(raw, H.capacity);

	// Fill the sub-objects the Excel template omits — inner fields are all
	// nullish, so `{}` / `[]` parse cleanly and the shelter can be configured
	// further in the form later.
	const input = {
		name: nameCell,
		operation_status: status.value,
		project_level: level.value ?? null,
		area_type: areaType.value ?? null,
		municipality_zone: zone.value,
		community: community.value,
		address_no: strOrNull(cell(raw, H.address_no)),
		village_no: strOrNull(cell(raw, H.village_no)),
		province: strOrNull(cell(raw, H.province)),
		district: strOrNull(cell(raw, H.district)),
		subdistrict: strOrNull(cell(raw, H.subdistrict)),
		postal_code: strOrNull(cell(raw, H.postal_code)),
		location: {
			address: strOrNull(cell(raw, H.address)),
			lat: numOrUndef(cell(raw, H.lat)),
			lng: numOrUndef(cell(raw, H.lng))
		},
		contact: {
			name: strOrNull(cell(raw, H.contact_name)),
			phone: strOrNull(cell(raw, H.contact_phone))
		},
		capacity: numOrUndef(capacityCell),
		area_m2: numOrUndef(cell(raw, H.area_m2)),
		facilities: {},
		common_areas: {},
		utilities: {},
		risk: {},
		zones: []
	};

	const parsed = createShelterSchema.safeParse(input);
	if (!parsed.success) {
		const erroredColumns = new Set(errors.map((e) => e.column));
		for (const issue of parsed.error.issues) {
			const header = PATH_TO_HEADER[issue.path.join('.')];
			if (!header || erroredColumns.has(header)) continue;
			// Give the required-capacity case a Thai message (schema can't, the value is undefined).
			const message =
				header === H.capacity && capacityCell === '' ? 'ต้องระบุความจุสูงสุด (คน)' : issue.message;
			errors.push({ column: header, message });
			erroredColumns.add(header);
		}
	}

	if (errors.length === 0 && parsed.success) {
		return { row, name, ok: true, shelter: parsed.data, errors: [] };
	}
	return { row, name, ok: false, errors };
}

/** Validate every row; returns validations in input order. */
export function validateRows(rows: readonly RawRow[], lookups: Lookups): RowValidation[] {
	return rows.map((raw, i) => validateRow(raw, i + 1, lookups));
}
