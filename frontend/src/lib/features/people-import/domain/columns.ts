import type { CardType, Gender, Religion } from '$lib/features/people';

/**
 * Column contract for the household/people Excel import (CR-071 slice A, T-72).
 *
 * Single source of truth shared by the template generator, the workbook parser
 * and the row validator — the Thai header text IS the key, so all three layers
 * agree without drift. Enum labels mirror the pre-registration wizard
 * (`household-pre-register-*.svelte`) so a downloaded template reads the same
 * as the app.
 *
 * The workbook mirrors what the wizard collects, split over three sheets joined
 * on the household's running number: two 1:1 sheets carrying the household's
 * own fields (its head person, then its address + belongings) plus one N:1
 * sheet for the members. The parser merges the 1:1 sheets into a single flat
 * row, so downstream code sees one {@link RawRow} per household plus that
 * household's member rows.
 *
 * The join key's header differs per sheet — `ลำดับที่` ({@link H.ref}) on the
 * 1:1 sheets, `ลำดับที่ครัวเรือน` ({@link H.member_household_ref}) on the member
 * sheet — so each {@link SheetDef} names its own via `refHeader` and the ref
 * column is flagged `isRef`; nothing outside compares header text to find it.
 *
 * The member sheet deliberately repeats the head's person headers verbatim
 * (`ชื่อ`, `นามสกุล`, …): its rows are never merged into a household row, so
 * the repetition cannot collide, and a person column reads the same wherever a
 * person is entered. Sheet attribution for an error therefore comes from the
 * validator's per-sheet sink, not from a global header → sheet map.
 *
 * Pure / isomorphic: no I/O, no Svelte. Values come from `evacueeInputSchema` /
 * `householdInputSchema` (features/people). Master-data choices are injected at
 * runtime — the domain only knows they resolve label → code.
 */

export interface EnumChoice<T extends string = string> {
	value: T;
	label: string;
}

/** Separator for multi-value cells. Not a comma — Thai option labels contain commas. */
export const MULTI_SEPARATOR = '|';
/** Field separator inside one composite item (pets, vehicles). */
export const FIELD_SEPARATOR = ':';

// ===== Enum choices (labels mirror the pre-registration wizard) =====

export const CARD_TYPE_CHOICES: EnumChoice<CardType>[] = [
	{ value: 'national_id', label: 'เลขประจำตัวประชาชน (Thai National ID)' },
	{ value: 'passport', label: 'หนังสือเดินทาง (Passport)' },
	{ value: 'pink_card', label: 'บัตรประจำตัวคนซึ่งไม่มีสัญชาติไทย (Pink Card)' },
	{ value: 'other', label: 'อื่นๆ (Other)' }
];

export const GENDER_CHOICES: EnumChoice<Gender>[] = [
	{ value: 'male', label: 'ชาย (Male)' },
	{ value: 'female', label: 'หญิง (Female)' },
	{ value: 'other', label: 'อื่นๆ (Other)' }
];

export const RELIGION_CHOICES: EnumChoice<Religion>[] = [
	{ value: 'buddhist', label: 'พุทธ (Buddhism)' },
	{ value: 'muslim', label: 'อิสลาม (Islam)' },
	{ value: 'christian', label: 'คริสต์ (Christianity)' },
	{ value: 'other', label: 'อื่นๆ (Other)' },
	{ value: 'unknown', label: 'ไม่ระบุ (Unknown)' }
];

/**
 * Vulnerability tags. Kept in step with the chip list the wizard renders
 * (`household-pre-register-head.svelte`) — `evacuee.special_needs` is a plain
 * string array in the schema, so this whitelist is what the importer accepts.
 */
export const SPECIAL_NEED_CHOICES: EnumChoice[] = [
	{ value: 'elderly', label: 'ผู้สูงอายุ' },
	{ value: 'disabled', label: 'พิการ' },
	{ value: 'pregnant', label: 'ครรภ์' },
	{ value: 'infant', label: 'เด็กเล็ก' },
	{ value: 'chronic_illness', label: 'โรคเรื้อรัง' },
	{ value: 'bedridden', label: 'ผู้ป่วยติดเตียง' }
];

export const PET_SPECIES_CHOICES: EnumChoice<'dog' | 'cat' | 'other'>[] = [
	{ value: 'dog', label: 'สุนัข' },
	{ value: 'cat', label: 'แมว' },
	{ value: 'other', label: 'อื่นๆ' }
];

/** CSV only — which person a flat row describes (see {@link CSV_SHEET}). */
export const ROLE_CHOICES: EnumChoice<'head' | 'member'>[] = [
	{ value: 'head', label: 'หัวหน้าครัวเรือน' },
	{ value: 'member', label: 'สมาชิก' }
];

export const VEHICLE_TYPE_CHOICES: EnumChoice<'car' | 'motorcycle' | 'other'>[] = [
	{ value: 'car', label: 'รถยนต์' },
	{ value: 'motorcycle', label: 'รถจักรยานยนต์' },
	{ value: 'other', label: 'อื่นๆ' }
];

// ===== Header text — the stable key used across template/parse/validate =====

export const H = {
	/** Join key on the 1:1 household sheets: the household's own running number. */
	ref: 'ลำดับที่',
	/**
	 * The same join key on the `สมาชิก` sheet, named for what it points at.
	 *
	 * A member row's own "ลำดับที่" reads like the member's running number, which
	 * is exactly what it is not — it is the household the member belongs to — so
	 * that sheet spells the column out instead.
	 */
	member_household_ref: 'ลำดับที่ครัวเรือน',
	/** CSV only — the flat file has no sheets, so each row says who it is. */
	role: 'บทบาท',

	// -- sheet 1: ครัวเรือน (the head person) --
	label: 'ชื่อครัวเรือน',
	card_type: 'ประเภทบัตร',
	id_number: 'เลขประจำตัว/เลขที่เอกสาร',
	first_name: 'ชื่อ',
	last_name: 'นามสกุล',
	nickname: 'ชื่อเล่น',
	gender: 'เพศ',
	birth_year: 'ปีเกิด (พ.ศ.)',
	age: 'อายุ (ปี)',
	phone: 'เบอร์โทรศัพท์',
	country: 'ประเทศ',
	religion: 'ศาสนา',
	special_needs: 'กลุ่มเปราะบาง (คั่นด้วย |)',
	medical_conditions: 'โรคประจำตัว (คั่นด้วย |)',
	medical_medications: 'ยาที่ใช้ประจำ (คั่นด้วย |)',
	medical_allergies: 'ประวัติการแพ้ (คั่นด้วย |)',
	medical_note: 'หมายเหตุด้านสุขภาพ',
	emergency_name: 'ผู้ติดต่อฉุกเฉิน: ชื่อ-นามสกุล',
	emergency_phone: 'ผู้ติดต่อฉุกเฉิน: เบอร์โทร',
	emergency_relation: 'ผู้ติดต่อฉุกเฉิน: ความสัมพันธ์',

	// -- sheet 2: ที่อยู่และทรัพย์สิน --
	address_no: 'บ้านเลขที่',
	village_no: 'หมู่ที่',
	subdistrict: 'ตำบล/แขวง',
	district: 'อำเภอ/เขต',
	province: 'จังหวัด',
	postal_code: 'รหัสไปรษณีย์',
	municipality_zone: 'เขตเทศบาล',
	community: 'ชุมชน',
	pets: 'สัตว์เลี้ยง (ชนิด:จำนวน:หมายเหตุ คั่นแต่ละรายการด้วย |)',
	vehicles: 'ยานพาหนะ (ประเภท:ทะเบียน คั่นแต่ละรายการด้วย |)',
	assets: 'ทรัพย์สินที่นำมา',
	notes: 'หมายเหตุครัวเรือน'
} as const;

export type ColumnKind = 'string' | 'number' | 'enum' | 'multi-enum' | 'masterdata';

/**
 * Columns Excel must not treat as numeric. Left as General, Excel turns
 * `0800000000` into the number 800000000 (leading zero gone) and a 13-digit ID
 * into scientific notation, so the template stamps these columns with the Text
 * format (`@`). Only genuine numeric columns stay General.
 */
export function isTextColumn(kind: ColumnKind): boolean {
	return kind !== 'number';
}

/**
 * Workbook header cell text → the bare header key used across the layers.
 *
 * The template marks a required column by appending a red " *" inside the
 * header cell itself (rich text — exceljs flattens every run into `cell.text`),
 * so the parser strips a trailing asterisk before matching. No Thai header ends
 * in "*", so the strip is unambiguous.
 */
export function normalizeHeader(text: string): string {
	return text.replace(/\s*\*+\s*$/, '').trim();
}

/**
 * master_data lists the importer resolves. Both are configured per shelter and
 * the import always lands in the shelter that is open on screen, so their
 * options are known at download time and ship as dropdowns in the template.
 */
export type MasterColumn = 'municipality_zone' | 'community';

export const MASTER_COLUMNS: readonly MasterColumn[] = ['municipality_zone', 'community'];

/**
 * Fields intentionally absent from the workbook — documented on the README sheet.
 *
 * Shelter zone allocation is capacity-sensitive and belongs to the zone screen
 * (T-09); stay status is locked to `pre_registered` for every imported row
 * (CR-071 — no per-row status column); photos are uploads, not cell values.
 */
export const APP_ONLY_FIELDS: readonly string[] = [
	'โซนพักพิงในศูนย์',
	'รูปถ่ายผู้ประสบภัย',
	'สถานะการเข้าพัก'
];

export interface ColumnDef {
	/** Thai header text — the key. */
	header: string;
	kind: ColumnKind;
	required: boolean;
	/** The sheet's join key (its header text differs per sheet — see the file doc). */
	isRef?: boolean;
	/** enum / multi-enum columns only — the fixed whitelist. */
	choices?: readonly EnumChoice[];
	/** masterdata columns only — which master_data type supplies the options. */
	masterType?: MasterColumn;
	/**
	 * Dotted path into the payload this column feeds, used to map a Zod issue
	 * back to this column. Omitted for columns the validator assembles by hand
	 * (pets, vehicles) or that are not payload fields (the join key).
	 */
	path?: string;
	/** Short helper text for the README sheet. */
	hint: string;
}

export interface SheetDef {
	/** Worksheet name. */
	name: string;
	/**
	 * `household` sheets are 1:1 and merged into one row by {@link H.ref};
	 * `member` sheets are N:1 and stay as repeated rows.
	 */
	kind: 'household' | 'member';
	columns: readonly ColumnDef[];
	/** Header text of this sheet's join key — the `isRef` column's header. */
	refHeader: string;
	/** Shown at the top of the README section for this sheet. */
	description: string;
}

/** The join-key column of a 1:1 household sheet. */
const refColumn: ColumnDef = {
	header: H.ref,
	kind: 'number',
	required: true,
	isRef: true,
	hint: 'เลขอ้างอิงครัวเรือน — ต้องตรงกันทุกชีต (ชีต "ครัวเรือน" คือตัวตั้ง)'
};

/** The same join key on the member sheet, pointing at the household it belongs to. */
const memberRefColumn: ColumnDef = {
	header: H.member_household_ref,
	kind: 'number',
	required: true,
	isRef: true,
	hint: `เลข "${H.ref}" ของครัวเรือนที่สมาชิกคนนี้สังกัด (ดูจากชีต "ครัวเรือน") — ไม่ใช่ลำดับของสมาชิก`
};

/**
 * The person columns, shared by the head (sheet 1) and every member (sheet 3).
 *
 * `pathPrefix` is '' for the head — its Zod issues land on the household
 * payload's own person fields — and the member sheet reuses the same defs, so a
 * person column can never drift between the two sheets.
 */
function personColumns(role: string): ColumnDef[] {
	return [
		{
			header: H.card_type,
			kind: 'enum',
			required: false,
			choices: CARD_TYPE_CHOICES,
			path: 'person_id.cardType',
			hint: 'ประเภทเอกสารแสดงตน (ว่าง = เลขประจำตัวประชาชน)'
		},
		{
			header: H.id_number,
			kind: 'string',
			required: false,
			path: 'person_id.number',
			hint: 'เลขบัตร/เลขที่เอกสาร — ใช้ตรวจว่าซ้ำกับคนที่มีอยู่แล้วในศูนย์'
		},
		{
			header: H.first_name,
			kind: 'string',
			required: true,
			path: 'first_name',
			hint: `ชื่อจริงของ${role} (จำเป็น)`
		},
		{
			header: H.last_name,
			kind: 'string',
			required: true,
			path: 'last_name',
			hint: `นามสกุลของ${role} (จำเป็น)`
		},
		{ header: H.nickname, kind: 'string', required: false, path: 'nickname', hint: 'ชื่อเล่น' },
		{
			header: H.gender,
			kind: 'enum',
			required: true,
			choices: GENDER_CHOICES,
			path: 'gender',
			hint: 'เพศ (จำเป็น)'
		},
		{
			header: H.birth_year,
			kind: 'number',
			required: false,
			path: 'birth_year',
			hint: 'ปีเกิดเป็น พ.ศ. เช่น 2530'
		},
		{
			header: H.age,
			kind: 'number',
			required: false,
			path: 'age',
			hint: 'อายุเป็นปี — กรอกเมื่อไม่ทราบปีเกิด'
		},
		{
			header: H.phone,
			kind: 'string',
			required: false,
			path: 'phone',
			hint: 'เบอร์โทรศัพท์ (ตัวเลขล้วน) — เว้นว่างได้เมื่อไม่มีเบอร์'
		},
		{
			header: H.country,
			kind: 'string',
			required: false,
			path: 'country',
			hint: 'ประเทศ (ว่าง = THAILAND)'
		},
		{
			header: H.religion,
			kind: 'enum',
			required: false,
			choices: RELIGION_CHOICES,
			path: 'religion',
			hint: 'ศาสนา (ว่าง = พุทธ)'
		},
		{
			header: H.special_needs,
			kind: 'multi-enum',
			required: false,
			choices: SPECIAL_NEED_CHOICES,
			path: 'special_needs',
			hint: 'แท็กกลุ่มเปราะบาง เลือกได้หลายค่า คั่นด้วย |'
		},
		{
			header: H.medical_conditions,
			kind: 'string',
			required: false,
			path: 'medical_conditions',
			hint: 'โรคประจำตัว หลายรายการคั่นด้วย | (ระบบสร้างระเบียนสุขภาพให้อัตโนมัติ)'
		},
		{
			header: H.medical_medications,
			kind: 'string',
			required: false,
			path: 'medical_medications',
			hint: 'ยาที่ใช้ประจำ หลายรายการคั่นด้วย |'
		},
		{
			header: H.medical_allergies,
			kind: 'string',
			required: false,
			path: 'medical_allergies',
			hint: 'ประวัติการแพ้ยา/อาหาร หลายรายการคั่นด้วย |'
		},
		{
			header: H.medical_note,
			kind: 'string',
			required: false,
			path: 'medical_note',
			hint: 'ความต้องการดูแลพิเศษหรือหมายเหตุด้านสุขภาพ'
		},
		{
			header: H.emergency_name,
			kind: 'string',
			required: false,
			path: 'emergency_contact.name',
			hint: 'ชื่อ-นามสกุลญาติ/ผู้ใกล้ชิด — กรอกครบทั้งสามช่องหรือเว้นว่างทั้งหมด'
		},
		{
			header: H.emergency_phone,
			kind: 'string',
			required: false,
			path: 'emergency_contact.phone',
			hint: 'เบอร์ติดต่อฉุกเฉิน 10 หลัก'
		},
		{
			header: H.emergency_relation,
			kind: 'string',
			required: false,
			path: 'emergency_contact.relation',
			hint: 'ความสัมพันธ์ เช่น บุตร, คู่สมรส (ว่าง = ผู้ติดต่อ)'
		}
	];
}

const SHEET_HOUSEHOLD: SheetDef = {
	name: 'ครัวเรือน',
	kind: 'household',
	refHeader: H.ref,
	description:
		'หนึ่งแถว = หนึ่งครัวเรือน พร้อมข้อมูลหัวหน้าครัวเรือน — ชีตนี้เป็นตัวตั้งของ "ลำดับที่"',
	columns: [
		refColumn,
		{
			header: H.label,
			kind: 'string',
			required: false,
			path: 'label',
			hint: 'ว่างได้ — ระบบตั้งให้เป็น "ครอบครัว{ชื่อ นามสกุล}" ของหัวหน้าครัวเรือน'
		},
		...personColumns('หัวหน้าครัวเรือน')
	]
};

const SHEET_ADDRESS: SheetDef = {
	name: 'ที่อยู่และทรัพย์สิน',
	kind: 'household',
	refHeader: H.ref,
	description: 'ที่อยู่ภูมิลำเนาและทรัพย์สินของครัวเรือน — ผูกกับชีต "ครัวเรือน" ด้วย "ลำดับที่"',
	columns: [
		refColumn,
		{
			header: H.address_no,
			kind: 'string',
			required: false,
			path: 'address_no',
			hint: 'บ้านเลขที่'
		},
		{ header: H.village_no, kind: 'string', required: false, path: 'village_no', hint: 'หมู่ที่' },
		{
			header: H.subdistrict,
			kind: 'string',
			required: false,
			path: 'subdistrict',
			hint: 'ตำบล/แขวง'
		},
		{ header: H.district, kind: 'string', required: false, path: 'district', hint: 'อำเภอ/เขต' },
		{ header: H.province, kind: 'string', required: false, path: 'province', hint: 'จังหวัด' },
		{
			header: H.postal_code,
			kind: 'string',
			required: false,
			path: 'postal_code',
			hint: 'รหัสไปรษณีย์'
		},
		{
			header: H.municipality_zone,
			kind: 'masterdata',
			required: false,
			masterType: 'municipality_zone',
			path: 'municipality_zone',
			hint: 'เลือกจากรายการเขตเทศบาลของศูนย์นี้'
		},
		{
			header: H.community,
			kind: 'masterdata',
			required: false,
			masterType: 'community',
			path: 'community',
			hint: 'เลือกจากรายการชุมชนของศูนย์นี้'
		},
		{
			header: H.pets,
			kind: 'string',
			required: false,
			hint: 'เช่น "สุนัข:2:มีกรง | แมว:1" — ชนิดใช้ได้: สุนัข, แมว, นก, อื่นๆ'
		},
		{
			header: H.vehicles,
			kind: 'string',
			required: false,
			hint: 'เช่น "รถยนต์:กข1234 | รถจักรยานยนต์:ขค5678" — ประเภทใช้ได้: รถยนต์, รถจักรยานยนต์, อื่นๆ'
		},
		{
			header: H.assets,
			kind: 'string',
			required: false,
			path: 'assets.description',
			hint: 'คำอธิบายทรัพย์สินที่นำติดตัวมา'
		},
		{
			header: H.notes,
			kind: 'string',
			required: false,
			path: 'notes',
			hint: 'หมายเหตุของครัวเรือน'
		}
	]
};

const SHEET_MEMBERS: SheetDef = {
	name: 'สมาชิก',
	kind: 'member',
	refHeader: H.member_household_ref,
	description: `หนึ่งแถว = สมาชิกหนึ่งคน (ไม่ต้องใส่หัวหน้าครัวเรือนซ้ำ) — ครัวเรือนหนึ่งมีได้หลายแถว ผูกกลับด้วย "${H.member_household_ref}" ซึ่งคือเลข "${H.ref}" ของชีตครัวเรือน`,
	columns: [memberRefColumn, ...personColumns('สมาชิก')]
};

/**
 * The flat CSV layout — the same contract as the workbook, in one table.
 *
 * A CSV file has no sheets, so the three-sheet split cannot survive it. Instead
 * each row is one person: `บทบาท` says whether the row is a household's head or
 * one of its members, `ลำดับที่` groups them, and the household's own columns
 * (name, address, belongings) are read from its head row. Header text is
 * identical to the workbook's, so the two formats never drift.
 */
const roleColumn: ColumnDef = {
	header: H.role,
	kind: 'enum',
	required: true,
	choices: ROLE_CHOICES,
	hint: 'หนึ่งครัวเรือนต้องมี "หัวหน้าครัวเรือน" หนึ่งแถวเท่านั้น ที่เหลือเป็น "สมาชิก"'
};

export const CSV_SHEET: SheetDef = {
	name: 'ผู้ประสบภัย',
	kind: 'household',
	refHeader: H.ref,
	description:
		'หนึ่งแถว = หนึ่งคน — คนในครัวเรือนเดียวกันใช้ "ลำดับที่" เดียวกัน และกรอกคอลัมน์ของครัวเรือน (ชื่อครัวเรือน, ที่อยู่, ทรัพย์สิน) เฉพาะแถวหัวหน้าครัวเรือน',
	columns: [
		refColumn,
		roleColumn,
		...personColumns('ผู้ประสบภัย'),
		...SHEET_HOUSEHOLD.columns.filter((c) => c.header === H.label),
		...SHEET_ADDRESS.columns.filter((c) => !c.isRef)
	]
};

export const CSV_COLUMNS: readonly ColumnDef[] = CSV_SHEET.columns;

/** Workbook layout, in tab order. */
export const SHEETS: readonly SheetDef[] = [SHEET_HOUSEHOLD, SHEET_ADDRESS, SHEET_MEMBERS];

export const MAIN_SHEET_NAME = SHEET_HOUSEHOLD.name;
export const ADDRESS_SHEET_NAME = SHEET_ADDRESS.name;
export const MEMBER_SHEET_NAME = SHEET_MEMBERS.name;

/** The 1:1 sheets the parser merges into a single row per household. */
export const HOUSEHOLD_SHEETS: readonly SheetDef[] = SHEETS.filter((s) => s.kind === 'household');

/** Every household-level column, flattened across the 1:1 sheets (excludes the join key). */
export const COLUMNS: readonly ColumnDef[] = HOUSEHOLD_SHEETS.flatMap((s) =>
	s.columns.filter((c) => !c.isRef)
);

/** Header texts in column order — used by the parser to map cells → keys. */
export const COLUMN_HEADERS: readonly string[] = COLUMNS.map((c) => c.header);

export const MEMBER_COLUMNS: readonly ColumnDef[] = SHEET_MEMBERS.columns.filter((c) => !c.isRef);

/**
 * header → sheet name, for the two merged 1:1 sheets only.
 *
 * The member sheet is excluded on purpose: it repeats the head's person headers
 * verbatim, so a global map would be ambiguous. Member errors get their sheet
 * name from the validator's per-sheet sink instead.
 */
export const HOUSEHOLD_HEADER_TO_SHEET: Readonly<Record<string, string>> = Object.fromEntries(
	HOUSEHOLD_SHEETS.flatMap((s) => s.columns.map((c) => [c.header, s.name] as const))
);

/** Dotted payload path → Thai header, derived from `ColumnDef.path` (no drift). */
export const PATH_TO_HEADER: Readonly<Record<string, string>> = Object.fromEntries(
	COLUMNS.filter((c) => c.path).map((c) => [c.path!, c.header] as const)
);

/** Same, for one member entry (paths are relative to the person object). */
export const MEMBER_PATH_TO_HEADER: Readonly<Record<string, string>> = Object.fromEntries(
	MEMBER_COLUMNS.filter((c) => c.path).map((c) => [c.path!, c.header] as const)
);
