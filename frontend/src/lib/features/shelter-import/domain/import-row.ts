import { z } from 'zod';
import { createShelterSchema } from '$lib/features/shelters/server';
import { zoneSchema } from '$lib/features/shelters';
import {
	FIELD_SEPARATOR,
	H,
	HEADER_TO_SHEET,
	MASTER_COLUMNS,
	PATH_TO_HEADER,
	SUB_STORAGE_TYPE_CHOICES,
	ZONE_PATH_TO_HEADER,
	AREA_TYPE_CHOICES,
	COMMUNICATION_COLUMNS,
	LUGGAGE_LIMITATION_CHOICES,
	LUGGAGE_RULE_CHOICES,
	OPERATION_STATUS_CHOICES,
	PARKING_AVAILABILITY_CHOICES,
	PARKING_RULE_CHOICES,
	PET_CONDITION_COLUMNS,
	PET_POLICY_CHOICES,
	POWER_SOURCE_CHOICES,
	PROJECT_LEVEL_CHOICES,
	WATER_SOURCE_CHOICES,
	ZONE_STATUS_CHOICES,
	ZONE_TYPE_CHOICES
} from './columns';
import type { EnumChoice, MasterColumn } from './columns';
import { findInFileDuplicates } from './duplicates';

/**
 * Pure mapping + validation for one workbook entry → a shelter create payload
 * (CR-039, extended to full `shelterSchema` coverage). No I/O, no Svelte:
 * master-data lookups are injected so the whole module stays isomorphic and
 * unit-testable.
 *
 * The parser hands us one merged {@link RawRow} per shelter (the four 1:1
 * sheets flattened on `ลำดับที่`) plus that shelter's zone rows. `validateRow`
 * resolves enum/master-data labels to codes, coerces numbers and booleans,
 * assembles the nested sub-objects (facilities / common_areas / utilities /
 * risk / zones / the three policy blocks), applies the same gating the form
 * applies, then runs `createShelterSchema` as the final gate. Errors carry the
 * Thai column header + sheet name so the UI can point at the cell.
 */

/** A parsed spreadsheet row: header text → trimmed cell string. */
export type RawRow = Record<string, string>;

/** One physical sheet row, tagged with its join key and 1-based data-row number. */
export interface RawSheetRow {
	/** Value of the sheet's join-key column ('' when the user left it blank). */
	ref: string;
	/** 1-based data row number within its sheet (excludes the header row). */
	line: number;
	cells: RawRow;
}

/** What {@link parseShelterWorkbook} produces. */
export interface ParsedWorkbook {
	/** One entry per shelter — the 1:1 sheets already merged. */
	shelters: RawSheetRow[];
	/** Zone rows, still one entry per zone. */
	zones: RawSheetRow[];
}

export interface RowFieldError {
	column: string;
	message: string;
	/** Worksheet the column lives on — omitted when it is the main sheet. */
	sheet?: string;
	/** Row number within `sheet`, for the N:1 zone sheet. */
	line?: number;
}

export type RowStatus =
	'created' | 'updated' | 'skipped_duplicate' | 'validation_error' | 'server_error';

/** Shelter create payload — inferred from the shared schema (no duplicate type). */
export type ShelterInput = z.infer<typeof createShelterSchema>;

export interface RowValidation {
	/** 1-based data row number on the main sheet (excludes the header row). */
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

function emptyLookup(): MasterLookup {
	return { byLabel: new Map(), codes: new Set() };
}

/** An empty lookup set — for tests / when master data is unavailable. */
export function emptyLookups(): Lookups {
	return Object.fromEntries(MASTER_COLUMNS.map((t) => [t, emptyLookup()])) as Lookups;
}

// ===== cell readers =====

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

/** Split a multi-value cell. Not comma-separated — Thai labels contain commas. */
function splitMulti(v: string): string[] {
	return v
		.split(/[|\r\n]+/)
		.map((s) => s.trim())
		.filter((s) => s !== '');
}

/** The Thai part before " (" — so "เตรียมพร้อม (Standby)" also matches "เตรียมพร้อม". */
function labelBase(label: string): string {
	const i = label.indexOf(' (');
	return (i === -1 ? label : label.slice(0, i)).trim();
}

function matchChoice(value: string, choices: readonly EnumChoice[]): EnumChoice | undefined {
	return choices.find(
		(c) => c.value === value || c.label === value || labelBase(c.label) === value
	);
}

/** Options list for an error message — labels, shortened so the toast stays readable. */
function optionList(choices: readonly EnumChoice[]): string {
	return choices.map((c) => labelBase(c.label)).join(', ');
}

// ===== error collector =====

interface ErrorSink {
	push(column: string, message: string, line?: number): void;
	readonly errors: RowFieldError[];
}

function createSink(): ErrorSink {
	const errors: RowFieldError[] = [];
	const seen = new Set<string>();
	return {
		errors,
		push(column, message, line) {
			const key = `${column}#${line ?? ''}`;
			if (seen.has(key)) return;
			seen.add(key);
			const sheet = HEADER_TO_SHEET[column];
			errors.push({
				column,
				message,
				...(sheet ? { sheet } : {}),
				...(line === undefined ? {} : { line })
			});
		}
	};
}

// ===== resolvers =====

function resolveEnum(
	raw: RawRow,
	header: string,
	choices: readonly EnumChoice[],
	sink: ErrorSink
): string | undefined {
	const value = cell(raw, header);
	if (value === '') return undefined;
	const match = matchChoice(value, choices);
	if (match) return match.value;
	sink.push(header, `ค่าต้องเป็นหนึ่งใน: ${optionList(choices)}`);
	return undefined;
}

function resolveMultiEnum(
	raw: RawRow,
	header: string,
	choices: readonly EnumChoice[],
	sink: ErrorSink
): string[] {
	const out: string[] = [];
	for (const part of splitMulti(cell(raw, header))) {
		const match = matchChoice(part, choices);
		if (!match) {
			sink.push(header, `ไม่รู้จักค่า "${part}" — ต้องเป็นหนึ่งใน: ${optionList(choices)}`);
			continue;
		}
		if (!out.includes(match.value)) out.push(match.value);
	}
	return out;
}

function resolveMaster(
	raw: RawRow,
	header: string,
	lookup: MasterLookup,
	sink: ErrorSink
): string | null {
	const value = cell(raw, header);
	if (value === '') return null;
	if (lookup.codes.has(value)) return value;
	const code = lookup.byLabel.get(value);
	if (code) return code;
	sink.push(header, `ไม่พบ "${value}" ในรายการ${header}`);
	return null;
}

const TRUE_WORDS = new Set(['ใช่', 'มี', 'true', 'yes', 'y', '1', '✓']);
const FALSE_WORDS = new Set(['ไม่ใช่', 'ไม่มี', 'false', 'no', 'n', '0', '-']);

function resolveBoolean(raw: RawRow, header: string, sink: ErrorSink): boolean | null {
	const value = cell(raw, header);
	if (value === '') return null;
	const key = value.toLowerCase();
	if (TRUE_WORDS.has(key)) return true;
	if (FALSE_WORDS.has(key)) return false;
	sink.push(header, 'ค่าต้องเป็น "ใช่" หรือ "ไม่ใช่"');
	return null;
}

/** Plain integer parse for the few fields whose schema has no `z.coerce`. */
function resolveInt(raw: RawRow, header: string, sink: ErrorSink): number | null {
	const value = cell(raw, header);
	if (value === '') return null;
	const n = Number(value);
	if (!Number.isInteger(n) || n < 0) {
		sink.push(header, 'ค่าต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป');
		return null;
	}
	return n;
}

/** `ชื่อ:ประเภท:ตร.ม.` items separated by `|` → sub_storage entries. */
function resolveSubStorage(raw: RawRow, sink: ErrorSink) {
	const out: { name: string; type: string; area_m2: number | null }[] = [];
	for (const item of splitMulti(cell(raw, H.sub_storage))) {
		const [rawName = '', rawType = '', rawArea = ''] = item
			.split(FIELD_SEPARATOR)
			.map((s) => s.trim());
		if (rawName === '') {
			sink.push(H.sub_storage, `รายการ "${item}" ไม่มีชื่อคลัง`);
			continue;
		}
		const type = rawType === '' ? 'general' : matchChoice(rawType, SUB_STORAGE_TYPE_CHOICES)?.value;
		if (!type) {
			sink.push(
				H.sub_storage,
				`ประเภทคลัง "${rawType}" ไม่ถูกต้อง — ต้องเป็นหนึ่งใน: ${optionList(SUB_STORAGE_TYPE_CHOICES)}`
			);
			continue;
		}
		let area: number | null = null;
		if (rawArea !== '') {
			const n = Number(rawArea);
			if (!Number.isFinite(n) || n < 0) {
				sink.push(H.sub_storage, `พื้นที่ของ "${rawName}" ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป`);
				continue;
			}
			area = n;
		}
		out.push({ name: rawName, type, area_m2: area });
	}
	return out;
}

// ===== zones (N:1 sheet) =====

type ParsedZone = z.infer<typeof zoneSchema>;

function buildZones(zoneRows: readonly RawSheetRow[], sink: ErrorSink): ParsedZone[] {
	const zones: ParsedZone[] = [];
	const seenCodes = new Set<string>();

	for (const { cells, line } of zoneRows) {
		const type = resolveEnumOnSheet(cells, H.zone_type, ZONE_TYPE_CHOICES, sink, line);
		const status = resolveEnumOnSheet(cells, H.zone_status, ZONE_STATUS_CHOICES, sink, line);

		const parsed = zoneSchema.safeParse({
			code: cell(cells, H.zone_code),
			name: cell(cells, H.zone_name),
			capacity: numOrUndef(cell(cells, H.zone_capacity)),
			type: type ?? 'general',
			status: status ?? 'active',
			area_m2: numOrUndef(cell(cells, H.zone_area_m2)),
			specifics: strOrNull(cell(cells, H.zone_specifics))
		});

		if (!parsed.success) {
			for (const issue of parsed.error.issues) {
				const header = ZONE_PATH_TO_HEADER[issue.path.join('.')] ?? H.zone_code;
				const message =
					header === H.zone_capacity && cell(cells, H.zone_capacity) === ''
						? 'ต้องระบุความจุของโซน (คน)'
						: issue.message;
				sink.push(header, message, line);
			}
			continue;
		}

		if (seenCodes.has(parsed.data.code)) {
			sink.push(H.zone_code, `รหัสโซน "${parsed.data.code}" ซ้ำภายในศูนย์เดียวกัน`, line);
			continue;
		}
		seenCodes.add(parsed.data.code);
		zones.push(parsed.data);
	}
	return zones;
}

/** {@link resolveEnum} but tagging the error with a zone-sheet row number. */
function resolveEnumOnSheet(
	raw: RawRow,
	header: string,
	choices: readonly EnumChoice[],
	sink: ErrorSink,
	line: number
): string | undefined {
	const value = cell(raw, header);
	if (value === '') return undefined;
	const match = matchChoice(value, choices);
	if (match) return match.value;
	sink.push(header, `ค่าต้องเป็นหนึ่งใน: ${optionList(choices)}`, line);
	return undefined;
}

// ===== pet policy (flattened across fixed columns) =====

function buildPetCategories(raw: RawRow, sink: ErrorSink) {
	const categories: Record<string, unknown>[] = [];

	// One ใช่/ไม่ใช่ column per condition, reassembled per category.
	const conditionsOf = (category: string) =>
		PET_CONDITION_COLUMNS.filter(
			(c) => c.category === category && resolveBoolean(raw, c.header, sink) === true
		).map((c) => c.value);

	const small = conditionsOf('small_general');
	const smallOther = strOrNull(cell(raw, H.pet_small_other));
	if (small.length > 0 || smallOther)
		categories.push({ category: 'small_general', conditions: small, other: smallOther });

	const large = conditionsOf('large_dog');
	const largeOther = strOrNull(cell(raw, H.pet_large_other));
	if (large.length > 0 || largeOther)
		categories.push({ category: 'large_dog', conditions: large, other: largeOther });

	const live = conditionsOf('livestock');
	const liveOther = strOrNull(cell(raw, H.pet_livestock_other));
	const liveCapacity = resolveInt(raw, H.pet_livestock_capacity, sink);
	const liveLocation = strOrNull(cell(raw, H.pet_livestock_location));
	if (live.length > 0 || liveOther || liveCapacity !== null || liveLocation)
		categories.push({
			category: 'livestock',
			conditions: live,
			other: liveOther,
			max_capacity: liveCapacity,
			location: liveLocation
		});

	return categories;
}

// ===== main entry point =====

/**
 * Validate + map a single shelter entry.
 *
 * @param raw   merged cells from the four 1:1 sheets
 * @param row   1-based data row number on the main sheet
 * @param zoneRows this shelter's rows from the `โซน` sheet
 */
export function validateRow(
	raw: RawRow,
	row: number,
	lookups: Lookups,
	zoneRows: readonly RawSheetRow[] = []
): RowValidation {
	const sink = createSink();
	const nameCell = cell(raw, H.name);
	const name = nameCell === '' ? null : nameCell;

	// -- sheet 1: identity, address, people --
	const status = resolveEnum(raw, H.operation_status, OPERATION_STATUS_CHOICES, sink);
	const level = resolveEnum(raw, H.project_level, PROJECT_LEVEL_CHOICES, sink);
	const areaType = resolveEnum(raw, H.area_type, AREA_TYPE_CHOICES, sink);
	const shelterType = resolveMaster(raw, H.shelter_type, lookups.shelter_type, sink);

	// -- sheet 2: facilities + common areas --
	const carToiletAccessible = resolveBoolean(raw, H.car_toilet_accessible, sink);
	const subStorage = resolveSubStorage(raw, sink);

	// -- sheet 3: utilities + risk --
	// One ใช่/ไม่ใช่ column per channel, reassembled into the schema's array.
	const communications = COMMUNICATION_COLUMNS.filter(
		({ header }) => resolveBoolean(raw, header, sink) === true
	).map(({ value }) => value);

	// -- sheet 4: policies --
	const petPolicy = resolveEnum(raw, H.pet_policy, PET_POLICY_CHOICES, sink);
	const luggageLimitation = resolveEnum(
		raw,
		H.luggage_limitation,
		LUGGAGE_LIMITATION_CHOICES,
		sink
	);
	const luggageRules = resolveMultiEnum(raw, H.luggage_rules, LUGGAGE_RULE_CHOICES, sink);
	const parkingAvailability = resolveEnum(
		raw,
		H.parking_availability,
		PARKING_AVAILABILITY_CHOICES,
		sink
	);
	const parkingRules = resolveMultiEnum(raw, H.parking_rules, PARKING_RULE_CHOICES, sink);

	// Gated fields — mirror what the form clears, so an import can't persist a
	// combination the UI would never produce (FR-23-6/26/30, D-A5).
	const supportedVehicles =
		parkingAvailability === 'available'
			? (
					[
						[H.park_motorcycle, 'motorcycle'],
						[H.park_car, 'car'],
						[H.park_truck, 'truck'],
						[H.park_boat, 'boat']
					] as const
				)
					.map(([header, type]) => ({ type, max_capacity: numOrUndef(cell(raw, header)) }))
					.filter((v) => v.max_capacity !== undefined)
			: [];

	const petCategories = petPolicy === 'conditional' ? buildPetCategories(raw, sink) : [];

	const zones = buildZones(zoneRows, sink);

	const capacityCell = cell(raw, H.capacity);

	const input = {
		name: nameCell,
		operation_status: status,
		shelter_type: shelterType,
		project_level: level ?? null,
		area_type: areaType ?? null,
		// Configured per shelter in the app, never in the workbook (APP_ONLY_FIELDS).
		municipality_zone: null,
		community: null,
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
		key_personnel: {
			eoc_liaison: {
				name: strOrNull(cell(raw, H.eoc_liaison_name)),
				phone: strOrNull(cell(raw, H.eoc_liaison_phone))
			},
			medical_lead: {
				name: strOrNull(cell(raw, H.medical_lead_name)),
				phone: strOrNull(cell(raw, H.medical_lead_phone))
			},
			kitchen_lead: {
				name: strOrNull(cell(raw, H.kitchen_lead_name)),
				phone: strOrNull(cell(raw, H.kitchen_lead_phone))
			}
		},
		capacity: numOrUndef(capacityCell),
		area_m2: numOrUndef(cell(raw, H.area_m2)),
		facilities: {
			toilets_male: numOrUndef(cell(raw, H.toilets_male)),
			toilets_female: numOrUndef(cell(raw, H.toilets_female)),
			toilets_accessible: numOrUndef(cell(raw, H.toilets_accessible)),
			showers: numOrUndef(cell(raw, H.showers)),
			water_points: numOrUndef(cell(raw, H.water_points)),
			handwashing_stations: numOrUndef(cell(raw, H.handwashing_stations)),
			car_toilet_accessible: carToiletAccessible,
			car_toilet_supported:
				carToiletAccessible === true ? numOrUndef(cell(raw, H.car_toilet_supported)) : null
		},
		common_areas: {
			central_kitchen: resolveBoolean(raw, H.central_kitchen, sink),
			helipad: resolveBoolean(raw, H.helipad, sink),
			isolation_room: resolveBoolean(raw, H.isolation_room, sink),
			women_child_friendly_space: resolveBoolean(raw, H.women_child_friendly_space, sink),
			parking_capacity: numOrUndef(cell(raw, H.parking_capacity)),
			logistics_area_m2: numOrUndef(cell(raw, H.logistics_area_m2)),
			sub_storage: subStorage
		},
		utilities: {
			power_source: resolveEnum(raw, H.power_source, POWER_SOURCE_CHOICES, sink) ?? null,
			water_source: resolveEnum(raw, H.water_source, WATER_SOURCE_CHOICES, sink) ?? null,
			communications,
			vhf_channel: strOrNull(cell(raw, H.vhf_channel))
		},
		risk: {
			elevation_m: numOrUndef(cell(raw, H.elevation_m)),
			entrance_description: strOrNull(cell(raw, H.entrance_description)),
			constraints: strOrNull(cell(raw, H.constraints)),
			secondary_muster_point: strOrNull(cell(raw, H.secondary_muster_point))
		},
		zones,
		admission_policy: {
			supported_vulnerable_groups: [],
			pet_policy: { policy: petPolicy ?? null, categories: petCategories }
		},
		luggage_policy: {
			limitation: luggageLimitation ?? null,
			max_per_family:
				luggageLimitation === 'limited' ? numOrUndef(cell(raw, H.luggage_max_per_family)) : null,
			rules: luggageRules,
			rules_other: strOrNull(cell(raw, H.luggage_rules_other))
		},
		parking_policy: {
			availability: parkingAvailability ?? null,
			supported_vehicles: supportedVehicles,
			rules: parkingRules,
			rules_other: strOrNull(cell(raw, H.parking_rules_other))
		}
	};

	const parsed = createShelterSchema.safeParse(input);
	if (!parsed.success) {
		for (const issue of parsed.error.issues) {
			const path = issue.path.join('.');
			// Zone issues are already reported per zone-sheet row above.
			if (path.startsWith('zones')) continue;
			const header = PATH_TO_HEADER[path];
			if (!header) continue;
			// Give the required-capacity case a Thai message (schema can't, the value is undefined).
			const message =
				header === H.capacity && capacityCell === '' ? 'ต้องระบุความจุสูงสุด (คน)' : issue.message;
			sink.push(header, message);
		}
	}

	if (sink.errors.length === 0 && parsed.success) {
		return { row, name, ok: true, shelter: parsed.data, errors: [] };
	}
	return { row, name, ok: false, errors: sink.errors };
}

/** Group zone rows by their `รหัสศูนย์พักพิง` value. */
function groupZonesByRef(zones: readonly RawSheetRow[]): Map<string, RawSheetRow[]> {
	const byRef = new Map<string, RawSheetRow[]>();
	for (const z of zones) {
		const list = byRef.get(z.ref);
		if (list) list.push(z);
		else byRef.set(z.ref, [z]);
	}
	return byRef;
}

/**
 * Validate a whole parsed workbook. Shelter rows keep their sheet order; each
 * one picks up the zone rows whose `รหัสศูนย์พักพิง` matches its `ลำดับที่`. A
 * shelter row with a blank `ลำดับที่` falls back to its position, so a
 * single-sheet file still works.
 */
export function validateWorkbook(wb: ParsedWorkbook, lookups: Lookups): RowValidation[] {
	const byRef = groupZonesByRef(wb.zones);
	const rows = wb.shelters.map((s, i) => {
		const ref = s.ref === '' ? String(i + 1) : s.ref;
		return validateRow(s.cells, i + 1, lookups, byRef.get(ref) ?? []);
	});

	const inFileDuplicates = findInFileDuplicates(rows);
	if (inFileDuplicates.size === 0) return rows;

	return rows.map((r) => {
		const firstRow = inFileDuplicates.get(r.row);
		if (firstRow === undefined) return r;
		const sheet = HEADER_TO_SHEET[H.name];
		return {
			...r,
			ok: false,
			shelter: undefined,
			errors: [
				...r.errors,
				{
					column: H.name,
					message: `ชื่อซ้ำกับแถวที่ ${firstRow} ในไฟล์เดียวกัน`,
					...(sheet ? { sheet } : {})
				}
			]
		};
	});
}

/**
 * Zone-sheet rows whose `รหัสศูนย์พักพิง` matches no shelter — surfaced as a warning
 * so a typo in the join key doesn't silently drop zones.
 */
export function orphanZoneRows(wb: ParsedWorkbook): RawSheetRow[] {
	const refs = new Set(wb.shelters.map((s, i) => (s.ref === '' ? String(i + 1) : s.ref)));
	return wb.zones.filter((z) => !refs.has(z.ref));
}

/** Validate shelter rows without zone data — kept for callers with a flat row list. */
export function validateRows(rows: readonly RawRow[], lookups: Lookups): RowValidation[] {
	return rows.map((raw, i) => validateRow(raw, i + 1, lookups));
}
