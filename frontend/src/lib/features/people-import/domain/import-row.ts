import {
	evacueeInputSchema,
	householdInputSchema,
	type EvacueeInput,
	type HouseholdInput
} from '$lib/features/people';
import {
	CARD_TYPE_CHOICES,
	FIELD_SEPARATOR,
	GENDER_CHOICES,
	H,
	HOUSEHOLD_HEADER_TO_SHEET,
	MASTER_COLUMNS,
	MEMBER_PATH_TO_HEADER,
	MEMBER_SHEET_NAME,
	PATH_TO_HEADER,
	PET_SPECIES_CHOICES,
	RELIGION_CHOICES,
	SPECIAL_NEED_CHOICES,
	VEHICLE_TYPE_CHOICES,
	type EnumChoice,
	type MasterColumn
} from './columns';
import { findInFileDuplicates, personDuplicateKey } from './duplicates';

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
 * Two rules are locked by CR-071 and are NOT expressible in the file: every
 * imported person is `registered_via: 'import'` and every household lands as
 * `pre_registered` (the factory stamps `current_stay.status` to match). There
 * is deliberately no status column.
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

/** One member of an importable household, tagged with the sheet row it came from. */
export interface MemberPayload {
	/** 1-based data row on the member sheet — shown when a member is skipped. */
	line: number;
	evacuee: EvacueeInput;
	/** Identity key used for duplicate detection; null when the row has none. */
	duplicateKey: string | null;
}

/** A ready-to-write household: its head, its own fields, and its members. */
export interface HouseholdImportPayload {
	/** `head_evacuee_id` stays null here — the writer fills it once the head exists. */
	household: HouseholdInput;
	head: EvacueeInput;
	headDuplicateKey: string | null;
	members: MemberPayload[];
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
	sink.push(header, `ไม่พบ "${value}" ในรายการ${header}ของศูนย์นี้`);
	return null;
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
 * Phone cells: digits only, and "ไม่มี"/"-" reads as no phone.
 *
 * `phoneSchema` is `nullable()` but rejects a non-numeric string, and Excel
 * users write "081-234-5678" — the separators are stripped here so a formatted
 * number imports instead of failing.
 */
const NO_PHONE_WORDS = new Set(['ไม่มี', '-', 'none', 'n/a']);

function resolvePhone(raw: RawRow, header: string, sink: ErrorSink): string | null {
	const value = cell(raw, header);
	if (value === '' || NO_PHONE_WORDS.has(value.toLowerCase())) return null;
	const digits = value.replace(/[\s\-().]/g, '');
	if (!/^[0-9]+$/.test(digits)) {
		sink.push(header, 'เบอร์โทรศัพท์ต้องเป็นตัวเลขเท่านั้น (เว้นว่างหรือใส่ "ไม่มี" ได้)');
		return null;
	}
	return digits;
}

/** `ชนิด:จำนวน:หมายเหตุ` items separated by `|` → household pets. */
function resolvePets(raw: RawRow, sink: ErrorSink) {
	const out: { species: 'dog' | 'cat' | 'bird' | 'other'; count: number; notes?: string }[] = [];
	for (const item of splitMulti(cell(raw, H.pets))) {
		const [rawSpecies = '', rawCount = '', rawNotes = ''] = item
			.split(FIELD_SEPARATOR)
			.map((s) => s.trim());
		const species = matchChoice(rawSpecies, PET_SPECIES_CHOICES)?.value;
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
		out.push({ species, count, ...(rawNotes ? { notes: rawNotes } : {}) });
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
function readPerson(raw: RawRow, sink: ErrorSink): EvacueeInput {
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
		gender: resolveEnum(raw, H.gender, GENDER_CHOICES, sink) as EvacueeInput['gender'],
		phone: resolvePhone(raw, H.phone, sink),
		...(cell(raw, H.nickname) ? { nickname: cell(raw, H.nickname) } : {}),
		...(birthYear !== undefined ? { birth_year: birthYear } : {}),
		...(age !== undefined ? { age } : {}),
		person_id: { cardType, number: idNumber },
		country: strOrUndef(cell(raw, H.country)) ?? 'THAILAND',
		religion: resolveEnum(raw, H.religion, RELIGION_CHOICES, sink) ?? 'buddhist',
		special_needs: resolveMultiEnum(raw, H.special_needs, SPECIAL_NEED_CHOICES, sink),
		medical_conditions: splitMulti(cell(raw, H.medical_conditions)),
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

function validateMembers(rows: readonly RawSheetRow[]): {
	members: MemberPayload[];
	errors: RowFieldError[];
} {
	const members: MemberPayload[] = [];
	const errors: RowFieldError[] = [];
	for (const row of rows) {
		const sink = createSink(MEMBER_SHEET_NAME, row.line);
		const person = readPerson(row.cells, sink);
		const ok = validatePerson(person, sink, MEMBER_PATH_TO_HEADER);
		if (ok && sink.errors.length === 0) {
			members.push({ line: row.line, evacuee: person, duplicateKey: personDuplicateKey(person) });
		} else {
			errors.push(...sink.errors);
		}
	}
	return { members, errors };
}

// ===== one household =====

export function validateRow(
	raw: RawRow,
	row: number,
	lookups: Lookups,
	memberRows: readonly RawSheetRow[] = []
): RowValidation {
	const sink = createSink(null);
	const head = readPerson(raw, sink);
	const headOk = validatePerson(head, sink, PATH_TO_HEADER);
	const headName = fullName(head) || null;

	const labelCell = cell(raw, H.label);
	const label = labelCell || (headName ? `ครอบครัว${headName}` : '');

	const assetDescription = cell(raw, H.assets);
	const household = {
		label,
		head_evacuee_id: null,
		// Locked by CR-071 / T-72 — no per-row status column exists.
		status: 'pre_registered' as const,
		checkout_destination: null,
		municipality_zone: resolveMaster(raw, H.municipality_zone, lookups.municipality_zone, sink),
		community: resolveMaster(raw, H.community, lookups.community, sink),
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

	const { members, errors: memberErrors } = validateMembers(memberRows);
	const errors = [...sink.errors, ...memberErrors];

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
				headDuplicateKey: personDuplicateKey(head),
				members
			},
			errors: []
		};
	}
	return {
		row,
		label: label || null,
		headName,
		memberCount: members.length,
		ok: false,
		errors
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
