import {
	deriveHouseholdStatus,
	evacueeInputSchema,
	householdInputSchema,
	type EvacueeInput,
	type HouseholdInput,
	type StayStatus
} from '$lib/features/people';
import {
	CARD_TYPE_CHOICES,
	FIELD_SEPARATOR,
	GENDER_CHOICES,
	H,
	HOUSEHOLD_HEADER_TO_SHEET,
	MEMBER_PATH_TO_HEADER,
	MEMBER_SHEET_NAME,
	PATH_TO_HEADER,
	PET_SPECIES_CHOICES,
	RELIGION_CHOICES,
	SPECIAL_NEED_CHOICES,
	STAY_STATUS_CHOICES,
	VEHICLE_TYPE_CHOICES,
	type EnumChoice
} from './columns';
import { isThaiMobilePhone, normalizeThaiPhone, THAI_MOBILE_PHONE_MESSAGE } from '$lib/db/model';
import { parseImportDateTime } from './datetime';
import { findInFileDuplicates, personDuplicateKey } from './duplicates';
import { resolveMasterCode, type MasterLabelFields } from '$lib/features/master-data/domain';

/**
 * Pure mapping + validation for one workbook entry → a household create payload
 * (CR-071 slice A / T-72). No I/O, no Svelte: master-data lookups are injected
 * so the whole module stays isomorphic and unit-testable.
 *
 * The parser hands us one merged {@link RawRow} per household (the two 1:1
 * sheets flattened on `ลำดับที่`) plus that household's member rows.
 * `validateRow` resolves enum/master-data labels to codes, coerces numbers,
 * assembles the nested sub-objects (person id, emergency contact, pets,
 * vehicles, assets), then runs `evacueeInputSchema` / `householdInputSchema` as
 * the final gate — the same schemas the pre-registration wizard submits
 * through, so the file cannot create anything the form could not.
 *
 * One rule is locked by CR-071: every imported person is `registered_via: 'import'`. The stay
 * itself is NOT locked any more — since the Backfill Import (#1399, decision sync on CR-071 T-72)
 * every row carries its real stay: status (`active` / `checked_out`), arrival time, departure
 * time and zone. `pre_registered` can no longer be imported from a file.
 *
 * Errors carry the Thai column header + sheet name so the UI can point at the
 * cell. The member sheet repeats the head's person headers, so sheet names come
 * from the sink each block is validated with, never from a global lookup.
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

/** What {@link parsePeopleWorkbook} produces. */
export interface ParsedWorkbook {
	/** One entry per household — the 1:1 sheets already merged. */
	households: RawSheetRow[];
	/** Member rows, still one entry per person. */
	members: RawSheetRow[];
}

export interface RowFieldError {
	column: string;
	message: string;
	/** Worksheet the column lives on. */
	sheet?: string;
	/** Row number within `sheet`, for the N:1 member sheet. */
	line?: number;
}

export type RowStatus = 'created' | 'skipped_duplicate' | 'validation_error' | 'server_error';

/**
 * The stay a row reports, resolved and ready to turn into movements (#1399). A row with a blank
 * `สถานะ` has no stay (`null`, #1448): the person stays `pre_registered` and waits for Report-in.
 */
export interface ImportStay {
	status: 'active' | 'checked_out';
	/** UTC ISO instant of the real check-in. */
	arrivedAt: string;
	/** UTC ISO instant of the real check-out; null while `active`. */
	departedAt: string | null;
	/** Zone code — always set for `active`, optional history for `checked_out`. */
	zone: string | null;
}

/** One member of an importable household, tagged with the sheet row it came from. */
export interface MemberPayload {
	/** 1-based data row on the member sheet — shown when a member is skipped. */
	line: number;
	evacuee: EvacueeInput;
	/** `null` = blank `สถานะ` → left `pre_registered`, no movement (#1448). */
	stay: ImportStay | null;
	/** Identity key used for duplicate detection; null when the row has none. */
	duplicateKey: string | null;
}

/** A ready-to-write household: its head, its own fields, and its members. */
export interface HouseholdImportPayload {
	/** `head_evacuee_id` stays null here — the writer fills it once the head exists. */
	household: HouseholdInput;
	head: EvacueeInput;
	/** `null` = blank `สถานะ` → left `pre_registered`, no movement (#1448). */
	headStay: ImportStay | null;
	headDuplicateKey: string | null;
	members: MemberPayload[];
}

/** How many people in a validated household have no stay and so wait for Report-in (#1448). */
export function countPendingReportIn(payload: HouseholdImportPayload): number {
	return [payload.headStay, ...payload.members.map((m) => m.stay)].filter((s) => s === null).length;
}

export interface RowValidation {
	/** 1-based data row number on the household sheet (excludes the header row). */
	row: number;
	label: string | null;
	headName: string | null;
	memberCount: number;
	ok: boolean;
	/** present when `ok` — the parsed, ready-to-write payload. */
	payload?: HouseholdImportPayload;
	errors: RowFieldError[];
	/** Non-blocking notes, e.g. values kept as free text (CR-186 FR-9). */
	warnings: RowFieldError[];
}

/** label → code map + the set of valid codes, for one master_data list. */
export interface MasterLookup {
	byLabel: Map<string, string>;
	codes: Set<string>;
}

/**
 * Active master items behind master-backed free-text columns, keyed by column
 * path (CR-186). Missing or empty → values are stored as typed, no warning.
 */
export interface Lookups {
	medical_conditions?: readonly MasterLabelFields[];
	/**
	 * The importing shelter's zones (#1399). Present → a zone cell must name one of them (by code
	 * or name) and an `active` person cannot take a closed one. Absent → the cell is taken as a
	 * code, unchecked (unit tests / a shelter whose zones could not be read).
	 */
	zones?: readonly ImportZone[];
	/** The clock for the "not in the future" rule — injected so tests are deterministic. */
	now?: Date;
}

/** The slice of a shelter zone the importer needs. */
export interface ImportZone {
	code: string;
	name: string;
	status?: string;
	capacity?: number | null;
}

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

/** An empty lookup set — CR-137: zone/community are free text (no master lookups). */
export function emptyLookups(): Lookups {
	return {};
}

// ===== cell readers =====

function cell(raw: RawRow, header: string): string {
	return (raw[header] ?? '').trim();
}

/** '' → null, else the trimmed string. */
function strOrNull(v: string): string | null {
	return v === '' ? null : v;
}

/** '' → undefined, so an optional field stays unset instead of failing `min(1)`. */
function strOrUndef(v: string): string | undefined {
	return v === '' ? undefined : v;
}

/** Split a multi-value cell. Not comma-separated — Thai labels contain commas. */
function splitMulti(v: string): string[] {
	return v
		.split(/[|\r\n]+/)
		.map((s) => s.trim())
		.filter((s) => s !== '');
}

/** The Thai part before " (" — so "ชาย (Male)" also matches "ชาย". */
function labelBase(label: string): string {
	const i = label.indexOf(' (');
	return (i === -1 ? label : label.slice(0, i)).trim();
}

function matchChoice<T extends string>(
	value: string,
	choices: readonly EnumChoice<T>[]
): EnumChoice<T> | undefined {
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
	push(column: string, message: string): void;
	readonly errors: RowFieldError[];
}

/**
 * Collect errors for one block of cells, all belonging to `sheet`.
 *
 * `line` is set for member blocks — the member sheet holds many rows per
 * household, so the row number is the only way to point at the right one. The
 * two 1:1 household sheets need no line (their row IS the household), but the
 * head's columns live on a different sheet from the address columns, so their
 * sink resolves the sheet name per header instead of taking a fixed one.
 */
function createSink(sheet: string | null, line?: number): ErrorSink {
	const errors: RowFieldError[] = [];
	const seen = new Set<string>();
	return {
		errors,
		push(column, message) {
			if (seen.has(column)) return;
			seen.add(column);
			const resolved = sheet ?? HOUSEHOLD_HEADER_TO_SHEET[column];
			errors.push({
				column,
				message,
				...(resolved ? { sheet: resolved } : {}),
				...(line === undefined ? {} : { line })
			});
		}
	};
}

// ===== resolvers =====

function resolveEnum<T extends string>(
	raw: RawRow,
	header: string,
	choices: readonly EnumChoice<T>[],
	sink: ErrorSink
): T | undefined {
	const value = cell(raw, header);
	if (value === '') return undefined;
	const match = matchChoice(value, choices);
	if (match) return match.value;
	sink.push(header, `ค่าต้องเป็นหนึ่งใน: ${optionList(choices)}`);
	return undefined;
}

function resolveMultiEnum<T extends string>(
	raw: RawRow,
	header: string,
	choices: readonly EnumChoice<T>[],
	sink: ErrorSink
): T[] {
	const out: T[] = [];
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

/** Plain integer parse — the caller decides what an out-of-range value means. */
function resolveInt(raw: RawRow, header: string, sink: ErrorSink): number | undefined {
	const value = cell(raw, header);
	if (value === '') return undefined;
	const n = Number(value);
	if (!Number.isInteger(n) || n < 0) {
		sink.push(header, 'ค่าต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป');
		return undefined;
	}
	return n;
}

/**
 * Phone cells: 10-digit mobile (CR-210; `+66` / separators normalised), and "ไม่มี"/"-" reads as no phone.
 *
 * `phoneSchema` is `nullable()` but rejects a non-numeric string, and Excel
 * users write "081-234-5678" — the separators are stripped here so a formatted
 * number imports instead of failing.
 */
const NO_PHONE_WORDS = new Set(['ไม่มี', '-', 'none', 'n/a']);

function resolvePhone(raw: RawRow, header: string, sink: ErrorSink): string | null {
	const value = cell(raw, header);
	if (value === '' || NO_PHONE_WORDS.has(value.toLowerCase())) return null;
	const phone = normalizeThaiPhone(value);
	if (!isThaiMobilePhone(phone)) {
		sink.push(header, `${THAI_MOBILE_PHONE_MESSAGE} (เว้นว่างหรือใส่ "ไม่มี" ได้)`);
		return null;
	}
	return phone;
}

/** `ชนิด:จำนวน:หมายเหตุ` items separated by `|` → household pets. */
function resolvePets(raw: RawRow, sink: ErrorSink) {
	const out: { species: 'dog' | 'cat' | 'other'; count: number; notes?: string }[] = [];
	for (const item of splitMulti(cell(raw, H.pets))) {
		const [rawSpecies = '', rawCount = '', rawNotes = ''] = item
			.split(FIELD_SEPARATOR)
			.map((s) => s.trim());
		const legacyBird = rawSpecies === 'bird' || rawSpecies === 'นก';
		const species = legacyBird ? 'other' : matchChoice(rawSpecies, PET_SPECIES_CHOICES)?.value;
		if (!species) {
			sink.push(
				H.pets,
				`ชนิดสัตว์เลี้ยง "${rawSpecies}" ไม่ถูกต้อง — ต้องเป็นหนึ่งใน: ${optionList(PET_SPECIES_CHOICES)}`
			);
			continue;
		}
		const count = rawCount === '' ? 1 : Number(rawCount);
		if (!Number.isInteger(count) || count < 1) {
			sink.push(H.pets, `จำนวนของ "${rawSpecies}" ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป`);
			continue;
		}
		const notes = legacyBird ? rawNotes || 'นก' : rawNotes;
		out.push({ species, count, ...(notes ? { notes } : {}) });
	}
	return out;
}

/** `ประเภท:ทะเบียน` items separated by `|` → household vehicles. */
function resolveVehicles(raw: RawRow, sink: ErrorSink) {
	const out: { type: 'car' | 'motorcycle' | 'other'; license_plate: string | null }[] = [];
	for (const item of splitMulti(cell(raw, H.vehicles))) {
		const [rawType = '', rawPlate = ''] = item.split(FIELD_SEPARATOR).map((s) => s.trim());
		const type = matchChoice(rawType, VEHICLE_TYPE_CHOICES)?.value;
		if (!type) {
			sink.push(
				H.vehicles,
				`ประเภทยานพาหนะ "${rawType}" ไม่ถูกต้อง — ต้องเป็นหนึ่งใน: ${optionList(VEHICLE_TYPE_CHOICES)}`
			);
			continue;
		}
		out.push({ type, license_plate: strOrNull(rawPlate) });
	}
	return out;
}

// ===== person block (shared by the head and every member) =====

/**
 * Read one person's columns into an `EvacueeInput`.
 *
 * Emergency contact is all-or-nothing: the schema requires a name and a
 * 10-digit phone once the object exists, so a partially filled contact is
 * reported here rather than silently dropped.
 */
/**
 * Map a multi-value cell onto master codes (CR-186 FR-9): a value matching an
 * active item's code or label becomes its code; the rest stay free text and are
 * reported through `warn` (non-blocking). Duplicates after mapping are dropped.
 */
function resolveMasterValues(
	values: readonly string[],
	items: readonly MasterLabelFields[] | undefined,
	header: string,
	warn: ErrorSink
): string[] {
	if (!items?.length) return [...values];
	const resolved: string[] = [];
	const freeText: string[] = [];
	for (const value of values) {
		const token = resolveMasterCode(value, items);
		if (!token || resolved.includes(token)) continue;
		resolved.push(token);
		if (!items.some((i) => i.code === token)) freeText.push(token);
	}
	if (freeText.length) {
		warn.push(
			header,
			`${freeText.map((v) => `"${v}"`).join(', ')} ไม่ตรงรายการ — จะเก็บเป็นข้อความ`
		);
	}
	return resolved;
}

function readPerson(raw: RawRow, sink: ErrorSink, lookups: Lookups, warn: ErrorSink): EvacueeInput {
	const emergencyName = cell(raw, H.emergency_name);
	const emergencyPhone = resolvePhone(raw, H.emergency_phone, sink);
	const emergencyRelation = cell(raw, H.emergency_relation);
	const hasEmergency = emergencyName !== '' || emergencyPhone !== null || emergencyRelation !== '';
	if (hasEmergency && emergencyName === '') {
		sink.push(H.emergency_name, 'กรอกผู้ติดต่อฉุกเฉินแล้วต้องระบุชื่อ-นามสกุลด้วย');
	}
	if (hasEmergency && emergencyPhone === null) {
		sink.push(H.emergency_phone, 'กรอกผู้ติดต่อฉุกเฉินแล้วต้องระบุเบอร์โทรด้วย');
	}

	const idNumber = cell(raw, H.id_number);
	const cardType = resolveEnum(raw, H.card_type, CARD_TYPE_CHOICES, sink) ?? 'national_id';
	const birthYear = resolveInt(raw, H.birth_year, sink);
	const age = resolveInt(raw, H.age, sink);

	return {
		first_name: cell(raw, H.first_name),
		last_name: cell(raw, H.last_name),
		// Blank cell = ไม่ระบุ (`null`) — gender is optional on every channel (decision sync 2026-10-09).
		gender: (resolveEnum(raw, H.gender, GENDER_CHOICES, sink) ?? null) as EvacueeInput['gender'],
		phone: resolvePhone(raw, H.phone, sink),
		...(cell(raw, H.nickname) ? { nickname: cell(raw, H.nickname) } : {}),
		...(birthYear !== undefined ? { birth_year: birthYear } : {}),
		...(age !== undefined ? { age } : {}),
		person_id: { cardType, number: idNumber },
		country: strOrUndef(cell(raw, H.country)) ?? 'THAILAND',
		religion: resolveEnum(raw, H.religion, RELIGION_CHOICES, sink) ?? 'buddhist',
		special_needs: resolveMultiEnum(raw, H.special_needs, SPECIAL_NEED_CHOICES, sink),
		medical_conditions: resolveMasterValues(
			splitMulti(cell(raw, H.medical_conditions)),
			lookups.medical_conditions,
			H.medical_conditions,
			warn
		),
		medical_medications: splitMulti(cell(raw, H.medical_medications)),
		medical_allergies: splitMulti(cell(raw, H.medical_allergies)),
		...(cell(raw, H.medical_note) ? { medical_note: cell(raw, H.medical_note) } : {}),
		...(hasEmergency && emergencyName !== '' && emergencyPhone !== null
			? {
					emergency_contact: {
						name: emergencyName,
						phone: emergencyPhone,
						relation: emergencyRelation || 'contact'
					}
				}
			: {}),
		household_id: null,
		photo: null,
		// Locked by CR-071 — the channel is never a column.
		registered_via: 'import'
		// Typo-guard: the schema's own input type, so a misspelled field name is a
		// compile error instead of a silently ignored cell.
	} satisfies EvacueeInput;
}

// ===== stay (Backfill Import, #1399) =====

function resolveInstant(raw: RawRow, header: string, sink: ErrorSink, now: Date): Date | null {
	const value = cell(raw, header);
	if (value === '') return null;
	const parsed = parseImportDateTime(value);
	if (!parsed) {
		sink.push(header, `รูปแบบเวลาไม่ถูกต้อง — ใช้ วว/ดด/ปปปป ชช:นน (พ.ศ.) เช่น 10/11/2569 14:00`);
		return null;
	}
	if (parsed.getTime() > now.getTime()) {
		sink.push(header, 'เวลาต้องไม่เลยเวลาปัจจุบัน');
		return null;
	}
	return parsed;
}

/** Match a zone cell against the shelter's zones by code or by name. */
function matchZone(value: string, zones: readonly ImportZone[]): ImportZone | undefined {
	return zones.find((z) => z.code === value || z.name.trim() === value);
}

/**
 * Read one person's stay columns. Returns `null` for a blank `สถานะ` (no stay — the person is
 * imported `pre_registered`, #1448) and also when any column is wrong; the second case always
 * leaves errors in `sink`, so callers must check `sink` before building a payload.
 */
function readStay(raw: RawRow, sink: ErrorSink, lookups: Lookups): ImportStay | null {
	const before = sink.errors.length;
	const now = lookups.now ?? new Date();

	if (cell(raw, H.stay_status) === '') {
		// Blank status = waits for Report-in at Station 1: nothing else about a stay may be given.
		for (const header of [H.arrived_at, H.departed_at, H.zone]) {
			if (cell(raw, header) !== '') {
				sink.push(
					header,
					`ไม่ได้ระบุ "${H.stay_status}" — เลือกสถานะ (${optionList(STAY_STATUS_CHOICES)}) หรือล้างค่า "${header}" ออก (ว่าง = รอรายงานตัวที่ Station 1)`
				);
			}
		}
		return null;
	}
	const status = resolveEnum(raw, H.stay_status, STAY_STATUS_CHOICES, sink);

	const arrived = resolveInstant(raw, H.arrived_at, sink, now);
	if (cell(raw, H.arrived_at) === '') sink.push(H.arrived_at, 'ต้องระบุเวลามา');
	const departed = resolveInstant(raw, H.departed_at, sink, now);

	if (status === 'active' && cell(raw, H.departed_at) !== '') {
		sink.push(H.departed_at, 'สถานะ "พักอยู่" ห้ามกรอกเวลากลับ');
	}
	if (status === 'checked_out' && cell(raw, H.departed_at) === '') {
		sink.push(H.departed_at, 'สถานะ "กลับแล้ว" ต้องระบุเวลากลับ');
	}
	if (arrived && departed && departed.getTime() < arrived.getTime()) {
		sink.push(H.departed_at, 'เวลากลับต้องไม่ก่อนเวลามา');
	}

	// Zone: required to be housed (CR-112 — a check_in needs a zone), optional history once left.
	const zoneCell = cell(raw, H.zone);
	let zone: string | null = null;
	if (zoneCell === '') {
		if (status === 'active') sink.push(H.zone, 'สถานะ "พักอยู่" ต้องระบุโซน');
	} else if (lookups.zones) {
		const match = matchZone(zoneCell, lookups.zones);
		if (!match) {
			sink.push(H.zone, `ไม่พบโซน "${zoneCell}" ในศูนย์นี้`);
		} else if (status === 'active' && match.status === 'closed') {
			sink.push(H.zone, `โซน "${match.name}" ปิดอยู่ — คนที่พักอยู่เลือกโซนที่ปิดไม่ได้`);
		} else {
			zone = match.code;
		}
	} else {
		zone = zoneCell;
	}

	if (sink.errors.length > before || !status || !arrived) return null;
	return {
		status,
		arrivedAt: arrived.toISOString(),
		departedAt: status === 'checked_out' && departed ? departed.toISOString() : null,
		zone
	};
}

/** Run the person through the same Zod gate the wizard submits through. */
function validatePerson(
	person: EvacueeInput,
	sink: ErrorSink,
	pathToHeader: Readonly<Record<string, string>>
): boolean {
	const parsed = evacueeInputSchema.safeParse(person);
	if (parsed.success) return true;
	for (const issue of parsed.error.issues) {
		const path = issue.path.join('.');
		// Never drop an issue: a row that fails with an empty error list shows up
		// in the preview as "ผิดพลาด" with no reason, and the user cannot fix it.
		sink.push(pathToHeader[path] ?? path, issue.message);
	}
	return false;
}

function fullName(person: EvacueeInput): string {
	return `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim();
}

// ===== members (N:1 sheet) =====

function validateMembers(
	rows: readonly RawSheetRow[],
	lookups: Lookups
): {
	members: MemberPayload[];
	errors: RowFieldError[];
	warnings: RowFieldError[];
} {
	const members: MemberPayload[] = [];
	const errors: RowFieldError[] = [];
	const warnings: RowFieldError[] = [];
	for (const row of rows) {
		const sink = createSink(MEMBER_SHEET_NAME, row.line);
		const warn = createSink(MEMBER_SHEET_NAME, row.line);
		const person = readPerson(row.cells, sink, lookups, warn);
		warnings.push(...warn.errors);
		const stay = readStay(row.cells, sink, lookups);
		const ok = validatePerson(person, sink, MEMBER_PATH_TO_HEADER);
		if (ok && sink.errors.length === 0) {
			members.push({
				line: row.line,
				evacuee: person,
				stay,
				duplicateKey: personDuplicateKey(person)
			});
		} else {
			errors.push(...sink.errors);
		}
	}
	return { members, errors, warnings };
}

// ===== one household =====

export function validateRow(
	raw: RawRow,
	row: number,
	lookups: Lookups,
	memberRows: readonly RawSheetRow[] = []
): RowValidation {
	const sink = createSink(null);
	const warn = createSink(null);
	const head = readPerson(raw, sink, lookups, warn);
	const headStay = readStay(raw, sink, lookups);
	const headOk = validatePerson(head, sink, PATH_TO_HEADER);
	const headName = fullName(head) || null;

	const labelCell = cell(raw, H.label);
	const label = labelCell || (headName ? `ครอบครัว${headName}` : '');

	const memberResult = validateMembers(memberRows, lookups);
	const assetDescription = cell(raw, H.assets);
	// A person without a stay (blank `สถานะ`) is `pre_registered`, and counts that way here.
	const stayStatuses: StayStatus[] = [
		headStay?.status ?? 'pre_registered',
		...memberResult.members.map((m) => m.stay?.status ?? 'pre_registered')
	];
	const householdStatus = deriveHouseholdStatus(stayStatuses);
	const household = {
		label,
		head_evacuee_id: null,
		// Derived from the people's stays (#1399) — the same rule the repository applies on write.
		status: householdStatus,
		// A household where everyone already left needs a destination (R-29-8); the file has none,
		// so it is preset to `returned_home` (#1399 decision). Never set while someone is housed.
		checkout_destination:
			householdStatus === 'checked_out' ? { type: 'returned_home' as const } : null,
		municipality_zone: strOrNull(cell(raw, H.municipality_zone)),
		community: strOrNull(cell(raw, H.community)),
		pets: resolvePets(raw, sink),
		vehicles: resolveVehicles(raw, sink),
		assets: assetDescription ? { description: assetDescription, image_url: null } : null,
		...(cell(raw, H.notes) ? { notes: cell(raw, H.notes) } : {}),
		address_no: strOrNull(cell(raw, H.address_no)),
		village_no: strOrNull(cell(raw, H.village_no)),
		subdistrict: strOrNull(cell(raw, H.subdistrict)),
		district: strOrNull(cell(raw, H.district)),
		province: strOrNull(cell(raw, H.province)),
		postal_code: strOrNull(cell(raw, H.postal_code))
	} satisfies HouseholdInput;

	const parsedHousehold = householdInputSchema.safeParse(household);
	if (!parsedHousehold.success) {
		for (const issue of parsedHousehold.error.issues) {
			const path = issue.path.join('.');
			// The label is derived from the head's name when the cell is blank, so an
			// empty label always means the head's name is missing — say that instead.
			const message =
				path === 'label' && labelCell === ''
					? `ตั้งชื่อครัวเรือนไม่ได้เพราะไม่มีชื่อหัวหน้าครัวเรือน — กรอก "${H.label}" หรือชื่อ-นามสกุล`
					: issue.message;
			sink.push(PATH_TO_HEADER[path] ?? path, message);
		}
	}

	const { members, errors: memberErrors, warnings: memberWarnings } = memberResult;
	const errors = [...sink.errors, ...memberErrors];
	const warnings = [...warn.errors, ...memberWarnings];

	if (errors.length === 0 && headOk && parsedHousehold.success) {
		return {
			row,
			label: label || null,
			headName,
			memberCount: members.length,
			ok: true,
			payload: {
				household,
				head,
				headStay,
				headDuplicateKey: personDuplicateKey(head),
				members
			},
			errors: [],
			warnings
		};
	}
	return {
		row,
		label: label || null,
		headName,
		memberCount: members.length,
		ok: false,
		errors,
		warnings
	};
}

/** Group member rows by their `ลำดับที่ครัวเรือน` value. */
function groupMembersByRef(members: readonly RawSheetRow[]): Map<string, RawSheetRow[]> {
	const byRef = new Map<string, RawSheetRow[]>();
	for (const m of members) {
		const list = byRef.get(m.ref);
		if (list) list.push(m);
		else byRef.set(m.ref, [m]);
	}
	return byRef;
}

/**
 * Validate a whole parsed workbook. Household rows keep their sheet order; each
 * one picks up the member rows whose `ลำดับที่ครัวเรือน` matches its `ลำดับที่`.
 * A household row with a blank `ลำดับที่` falls back to its position, so a file
 * whose join keys were cleared still works.
 */
export function validateWorkbook(wb: ParsedWorkbook, lookups: Lookups): RowValidation[] {
	const byRef = groupMembersByRef(wb.members);
	const rows = wb.households.map((h, i) => {
		const ref = h.ref === '' ? String(i + 1) : h.ref;
		return validateRow(h.cells, i + 1, lookups, byRef.get(ref) ?? []);
	});

	const inFile = findInFileDuplicates(rows);
	if (inFile.size === 0) return rows;

	return rows.map((r) => {
		const clash = inFile.get(r.row);
		if (!clash) return r;
		return {
			...r,
			ok: false,
			payload: undefined,
			errors: [
				...r.errors,
				{
					column: H.id_number,
					message: clash.message,
					sheet: clash.sheet,
					...(clash.line === undefined ? {} : { line: clash.line })
				}
			]
		};
	});
}

/**
 * Member rows whose `ลำดับที่ครัวเรือน` matches no household — surfaced as a
 * warning so a typo in the join key doesn't silently drop people.
 */
export function orphanMemberRows(wb: ParsedWorkbook): RawSheetRow[] {
	const refs = new Set(wb.households.map((h, i) => (h.ref === '' ? String(i + 1) : h.ref)));
	return wb.members.filter((m) => !refs.has(m.ref));
}

/**
 * A file made from the pre-#1399 template has no `สถานะ` column at all (the parser only keeps
 * headers it knows, so an absent column is an absent key). Every row would then fail with the same
 * "status required" error — worth one clear message instead: download the new template.
 */
export function isLegacyTemplate(wb: ParsedWorkbook): boolean {
	return wb.households.length > 0 && wb.households.every((h) => !(H.stay_status in h.cells));
}
