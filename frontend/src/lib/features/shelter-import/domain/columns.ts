import type {
	AreaType,
	CommunicationChannel,
	LuggageRule,
	OperationStatus,
	ParkingRule,
	PetCategory,
	PetCondition,
	PowerSource,
	ProjectLevel,
	SubStorageType,
	VehicleType,
	WaterSource,
	ZoneStatus,
	ZoneType
} from '$lib/features/shelters';
import {
	luggageRuleLabels,
	parkingRuleLabels,
	petCategoryConditions,
	petCategoryOrder,
	petConditionLabels
} from '$lib/features/shelters';

/**
 * Column contract for the shelter Excel import (CR-039, extended to full
 * `shelterSchema` coverage).
 *
 * Single source of truth shared by the template generator, the xlsx parser and
 * the row validator — header text (Thai) IS the key, so all three layers agree
 * without drift. Enum labels mirror the shelter form sections so a downloaded
 * template reads the same as the app.
 *
 * The workbook is split into five sheets joined on the shelter's running
 * number: four 1:1 sheets carrying the shelter's own fields (grouped the way
 * the form groups them, so a ~70-column contract stays readable) plus one N:1
 * sheet for `zones[]`. The parser merges the 1:1 sheets back into a single flat
 * row, so downstream code still sees one `RawRow` per shelter.
 *
 * The join key's header differs per sheet — `ลำดับที่` ({@link H.ref}) on the
 * 1:1 sheets, `รหัสศูนย์พักพิง` ({@link H.zone_shelter_ref}) on the zone sheet —
 * so each {@link SheetDef} names its own via `refHeader` and the ref column is
 * flagged `isRef`; nothing outside compares header text to find it.
 *
 * Pure / isomorphic: no I/O, no Svelte. Values come from `shelterSchema`
 * (features/shelters). Master-data choices are injected at runtime — the domain
 * only knows they resolve label → code.
 */

export interface EnumChoice<T extends string = string> {
	value: T;
	label: string;
}

/** Separator for multi-value cells. Not a comma — Thai option labels contain commas. */
export const MULTI_SEPARATOR = '|';
/** Field separator inside one composite item (sub-storage list). */
export const FIELD_SEPARATOR = ':';

// ===== Enum choices (labels mirror the shelter form) =====

export const BOOLEAN_CHOICES: EnumChoice<'true' | 'false'>[] = [
	{ value: 'true', label: 'ใช่' },
	{ value: 'false', label: 'ไม่ใช่' }
];

export const OPERATION_STATUS_CHOICES: EnumChoice<OperationStatus>[] = [
	{ value: 'standby', label: 'เตรียมพร้อม (Standby)' },
	{ value: 'active', label: 'เปิดรับผู้อพยพ (Active)' },
	{ value: 'full_capacity', label: 'เต็มความจุ (Full Capacity)' },
	{ value: 'closed', label: 'ปิดศูนย์ (Closed)' }
];

export const PROJECT_LEVEL_CHOICES: EnumChoice<ProjectLevel>[] = [
	{ value: 'community', label: 'ระดับชุมชน (จุดพักพิงย่อย/บ้านพี่เลี้ยง)' },
	{ value: 'lao', label: 'ระดับ อปท. (ศูนย์พักพิงหลักของเทศบาล)' },
	{ value: 'provincial', label: 'ระดับเมือง/จังหวัด (ศูนย์บัญชาการขนาดใหญ่/จุดยุทธศาสตร์)' }
];

export const AREA_TYPE_CHOICES: EnumChoice<AreaType>[] = [
	{ value: 'indoor', label: 'อาคารปิด (Indoor)' },
	{ value: 'outdoor', label: 'ลานเปิด (Outdoor)' },
	{ value: 'hybrid', label: 'แบบผสม (Hybrid)' }
];

export const POWER_SOURCE_CHOICES: EnumChoice<PowerSource>[] = [
	{ value: 'city_grid', label: 'ไฟฟ้านครหลวง/ภูมิภาค (City Grid)' },
	{ value: 'generator', label: 'เครื่องปั่นไฟ (Generator)' },
	{ value: 'solar', label: 'โซลาร์เซลล์ (Solar)' }
];

export const WATER_SOURCE_CHOICES: EnumChoice<WaterSource>[] = [
	{ value: 'city_water', label: 'น้ำประปา (City Water)' },
	{ value: 'water_tank', label: 'แท็งก์น้ำสำรอง (Water Tank)' },
	{ value: 'groundwater', label: 'บ่อบาดาล (Groundwater)' }
];

export const COMMUNICATION_CHOICES: EnumChoice<CommunicationChannel>[] = [
	{ value: 'cellular', label: 'สัญญาณมือถือ (Cellular)' },
	{ value: 'wifi', label: 'Wi-Fi ของศูนย์' },
	{ value: 'vhf_radio', label: 'วิทยุสื่อสาร VHF (Analog/Local)' }
];

export const SUB_STORAGE_TYPE_CHOICES: EnumChoice<SubStorageType>[] = [
	{ value: 'general', label: 'ทั่วไป' },
	{ value: 'food_dry', label: 'อาหารแห้ง' },
	{ value: 'drinking_water', label: 'น้ำดื่ม' },
	{ value: 'medical_supplies', label: 'เวชภัณฑ์' }
];

export const ZONE_TYPE_CHOICES: EnumChoice<ZoneType>[] = [
	{ value: 'general', label: 'ทั่วไป' },
	{ value: 'male', label: 'ชายล้วน' },
	{ value: 'female', label: 'หญิงล้วน' },
	{ value: 'vulnerable', label: 'เปราะบาง' },
	{ value: 'pet', label: 'สัตว์เลี้ยง' },
	{ value: 'quarantine', label: 'กักโรค' }
];

export const ZONE_STATUS_CHOICES: EnumChoice<ZoneStatus>[] = [
	{ value: 'active', label: 'เปิดใช้งาน' },
	{ value: 'closed', label: 'ปิด' }
];

export const PET_POLICY_CHOICES: EnumChoice<'no_pets' | 'conditional'>[] = [
	{ value: 'no_pets', label: 'ไม่อนุญาตให้นำสัตว์เลี้ยงเข้าศูนย์ (No Pets Allowed)' },
	{
		value: 'conditional',
		label: 'อนุญาตให้นำสัตว์เลี้ยงเข้าได้ภายใต้เงื่อนไข (Pets Allowed with Conditions)'
	}
];

export const LUGGAGE_LIMITATION_CHOICES: EnumChoice<'no_limit' | 'limited'>[] = [
	{ value: 'no_limit', label: 'ไม่จำกัดปริมาณสัมภาระ (No Limits)' },
	{ value: 'limited', label: 'จำกัดปริมาณสัมภาระพื้นที่จำกัด (Limited Luggage)' }
];

export const PARKING_AVAILABILITY_CHOICES: EnumChoice<'none' | 'available'>[] = [
	{ value: 'none', label: 'ไม่มีพื้นที่จอดรถ (No Parking Available)' },
	{ value: 'available', label: 'มีพื้นที่จอดรถ (Parking Available)' }
];

export const VEHICLE_TYPE_CHOICES: EnumChoice<VehicleType>[] = [
	{ value: 'motorcycle', label: 'รถจักรยานยนต์ (Motorcycles)' },
	{ value: 'car', label: 'รถยนต์ / รถกระบะ (Cars / Pickups)' },
	{ value: 'truck', label: 'รถบรรทุก / รถขนาดใหญ่ (Trucks / Heavy Vehicles)' },
	{ value: 'boat', label: 'เรืออพยพ / เรือเล็ก (Boats)' }
];

/** Luggage/parking/pet rule choices reuse the form's label maps verbatim. */
export const LUGGAGE_RULE_CHOICES: EnumChoice<LuggageRule>[] = (
	Object.keys(luggageRuleLabels) as LuggageRule[]
).map((value) => ({ value, label: luggageRuleLabels[value] }));

export const PARKING_RULE_CHOICES: EnumChoice<ParkingRule>[] = (
	Object.keys(parkingRuleLabels) as ParkingRule[]
).map((value) => ({ value, label: parkingRuleLabels[value] }));

/**
 * Short column headers for the pet conditions. `petConditionLabels` holds full
 * sentences ("ผู้พักพิงต้องเตรียมกรง / กระเป๋า / โหล มาเอง …") which make
 * unusable column headers, so each gets a compact prefixed name here and the
 * full sentence rides along as the cell comment + README text.
 */
const PET_CONDITION_HEADERS: Record<PetCondition, string> = {
	bring_own_cage: 'สัตว์เล็ก: เตรียมกรงมาเอง',
	caged_or_leashed: 'สัตว์เล็ก: อยู่ในกรง/มีสายจูง',
	vaccine_book: 'สัตว์เล็ก: ต้องมีสมุดวัคซีน',
	owner_hygiene: 'สัตว์เล็ก: เจ้าของดูแลความสะอาด',
	closed_system_only: 'สัตว์เล็ก: เฉพาะระบบปิด',
	muzzle_and_leash: 'สุนัขใหญ่: ต้องสวมตะกร้อ + สายจูง',
	designated_zone_only: 'สุนัขใหญ่: อยู่ในโซนที่กำหนด',
	vaccine_book_mandatory: 'สุนัขใหญ่: ต้องมีสมุดวัคซีน (บังคับ)',
	aggressive_behavior_expel_right: 'สุนัขใหญ่: ก้าวร้าว = สงวนสิทธิ์เชิญออก',
	owner_provides_feed: 'ปศุสัตว์: เจ้าของเตรียมอาหารเอง',
	tethered_designated_area_only: 'ปศุสัตว์: ผูกล่ามในพื้นที่ที่กำหนด'
};

/**
 * One ใช่/ไม่ใช่ column per pet condition, grouped by category.
 *
 * `pet_policy.categories[].conditions` is an array, and a spreadsheet cell is a
 * poor multi-select — Excel data validation offers only one value per cell — so
 * the columns are flattened here and `validateRow` reassembles the arrays.
 */
export const PET_CONDITION_COLUMNS: readonly {
	category: PetCategory;
	value: PetCondition;
	header: string;
	label: string;
}[] = petCategoryOrder.flatMap((category) =>
	petCategoryConditions[category].map((value) => ({
		category,
		value,
		header: PET_CONDITION_HEADERS[value],
		label: petConditionLabels[value]
	}))
);

// ===== Header text — the stable key used across template/parse/validate =====

export const H = {
	/** Join key on the 1:1 shelter sheets: the shelter's own running number. */
	ref: 'ลำดับที่',
	/**
	 * Same join key on the `โซน` sheet, named for what it points at.
	 *
	 * A zone row's own "ลำดับที่" reads like the zone's running number, which is
	 * exactly what it is not — it is the shelter the zone belongs to — so that
	 * sheet spells the column out instead.
	 */
	zone_shelter_ref: 'รหัสศูนย์พักพิง',

	// -- sheet 1: ข้อมูลศูนย์ --
	name: 'ชื่อศูนย์พักพิง',
	operation_status: 'สถานะ',
	shelter_type: 'ประเภทศูนย์พักพิง',
	project_level: 'ระดับโครงการ',
	area_type: 'สถานะพื้นที่อาคาร',
	capacity: 'ความจุสูงสุด (คน)',
	area_m2: 'พื้นที่ใช้สอยรวม (ตร.ม.)',
	address: 'ที่อยู่ตามเขตการปกครอง',
	lat: 'ละติจูด',
	lng: 'ลองจิจูด',
	address_no: 'บ้านเลขที่',
	village_no: 'หมู่ที่',
	province: 'จังหวัด',
	district: 'อำเภอ/เขต',
	subdistrict: 'ตำบล/แขวง',
	postal_code: 'รหัสไปรษณีย์',
	contact_name: 'ผู้จัดการศูนย์',
	contact_phone: 'เบอร์โทรผู้จัดการศูนย์',
	eoc_liaison_name: 'ผู้ประสานงาน EOC',
	eoc_liaison_phone: 'เบอร์โทรผู้ประสานงาน EOC',
	medical_lead_name: 'หัวหน้าฝ่ายพยาบาล',
	medical_lead_phone: 'เบอร์โทรหัวหน้าฝ่ายพยาบาล',
	kitchen_lead_name: 'หัวหน้าฝ่ายครัว',
	kitchen_lead_phone: 'เบอร์โทรหัวหน้าฝ่ายครัว',

	// -- sheet 2: สิ่งอำนวยความสะดวก --
	toilets_male: 'ห้องน้ำชาย (ห้อง)',
	toilets_female: 'ห้องน้ำหญิง (ห้อง)',
	toilets_accessible: 'ห้องน้ำผู้พิการ (ห้อง)',
	showers: 'ห้องอาบน้ำ (ห้อง)',
	water_points: 'จุดจ่ายน้ำ (จุด)',
	handwashing_stations: 'จุดล้างมือ (จุด)',
	car_toilet_accessible: 'รองรับรถสุขาเคลื่อนที่',
	car_toilet_supported: 'จำนวนรถสุขาที่รองรับ (คัน)',
	central_kitchen: 'มีโรงครัวกลาง',
	helipad: 'มีลานจอด ฮ.',
	isolation_room: 'มีห้องแยกกักโรค',
	women_child_friendly_space: 'มีพื้นที่ปลอดภัยสำหรับสตรีและเด็ก',
	parking_capacity: 'ความจุที่จอดรถ (คัน)',
	logistics_area_m2: 'พื้นที่โลจิสติกส์ (ตร.ม.)',
	sub_storage: 'คลังย่อย (ชื่อ:ประเภท:ตร.ม. คั่นแต่ละรายการด้วย |)',

	// -- sheet 3: สาธารณูปโภคและความเสี่ยง --
	power_source: 'แหล่งพลังงานหลัก',
	water_source: 'แหล่งน้ำหลัก',
	comm_cellular: 'มีสัญญาณมือถือ',
	comm_wifi: 'มี Wi-Fi ของศูนย์',
	comm_vhf: 'มีวิทยุสื่อสาร VHF',
	vhf_channel: 'ช่องสัญญาณ VHF',
	elevation_m: 'ความสูงจากระดับน้ำทะเล (ม.)',
	entrance_description: 'ลักษณะทางเข้า-ออก',
	constraints: 'ข้อจำกัด/ความเสี่ยงของพื้นที่',
	secondary_muster_point: 'จุดรวมพลสำรอง',

	// -- sheet 4: นโยบาย --
	pet_policy: 'นโยบายสัตว์เลี้ยง',
	pet_small_other: 'เงื่อนไขอื่นๆ: สัตว์เลี้ยงขนาดเล็ก',
	pet_large_other: 'เงื่อนไขอื่นๆ: สุนัขขนาดใหญ่',
	pet_livestock_other: 'เงื่อนไขอื่นๆ: ปศุสัตว์',
	pet_livestock_capacity: 'จำนวนปศุสัตว์สูงสุด (ตัว)',
	pet_livestock_location: 'จุดรองรับปศุสัตว์',
	luggage_limitation: 'ข้อกำหนดปริมาณสัมภาระ',
	luggage_max_per_family: 'จำกัดสัมภาระต่อครอบครัว (ชิ้น)',
	luggage_rules: 'กฎเรื่องสัมภาระ/ทรัพย์สิน (คั่นด้วย |)',
	luggage_rules_other: 'กฎเรื่องสัมภาระ: อื่นๆ',
	parking_availability: 'พื้นที่จอดรถ',
	park_motorcycle: 'จำนวนที่จอดรถจักรยานยนต์ (คัน)',
	park_car: 'จำนวนที่จอดรถยนต์/กระบะ (คัน)',
	park_truck: 'จำนวนที่จอดรถบรรทุก (คัน)',
	park_boat: 'จำนวนที่จอดเรือ (ลำ)',
	parking_rules: 'กฎเรื่องที่จอดรถ (คั่นด้วย |)',
	parking_rules_other: 'กฎเรื่องที่จอดรถ: อื่นๆ',

	// -- sheet 5: โซน (N rows per shelter) --
	zone_code: 'รหัสโซน',
	zone_name: 'ชื่อโซน',
	zone_capacity: 'ความจุโซน (คน)',
	zone_type: 'ประเภทโซน',
	zone_status: 'สถานะโซน',
	zone_area_m2: 'พื้นที่โซน (ตร.ม.)',
	zone_specifics: 'รายละเอียดโซน'
} as const;

/**
 * `utilities.communications` is an array, but a spreadsheet cell is a poor
 * multi-select — Excel data validation can only offer one value per cell. So the
 * three channels each get their own ใช่/ไม่ใช่ column and the validator
 * reassembles the array.
 */
export const COMMUNICATION_COLUMNS: readonly {
	header: string;
	value: CommunicationChannel;
	label: string;
}[] = [
	{ header: H.comm_cellular, value: 'cellular', label: 'สัญญาณมือถือ (Cellular)' },
	{ header: H.comm_wifi, value: 'wifi', label: 'Wi-Fi ของศูนย์' },
	{ header: H.comm_vhf, value: 'vhf_radio', label: 'วิทยุสื่อสาร VHF (Analog/Local)' }
];

export type ColumnKind = 'string' | 'number' | 'boolean' | 'enum' | 'multi-enum' | 'masterdata';

/**
 * Columns Excel must not treat as numeric. Left as General, Excel turns
 * `0800000000` into the number 800000000 (leading zero gone) and `1/2` into a
 * date, so the template stamps these columns with the Text format (`@`).
 * Only genuine numeric columns stay General.
 */
export function isTextColumn(kind: ColumnKind): boolean {
	return kind !== 'number';
}

/**
 * Workbook header cell text → the bare header key used across the layers.
 *
 * The template marks a required column by appending a red " *" inside the
 * header cell itself (rich text — exceljs flattens every run into
 * `cell.text`), so the parser strips a trailing asterisk before matching.
 * No Thai header ends in "*", so the strip is unambiguous. Workbooks from the
 * earlier template — which carried the asterisk in its own narrow column —
 * normalize that cell to '' and it is ignored like any unknown column.
 */
export function normalizeHeader(text: string): string {
	return text.replace(/\s*\*+\s*$/, '').trim();
}

/**
 * master_data lists the importer resolves.
 *
 * Deliberately narrow: `municipality_zone`, `community` and `vulnerable_group`
 * are configured per shelter in the app after import, not in the spreadsheet —
 * their values differ shelter by shelter and change often enough that a
 * downloaded template would go stale, so they are left out of the workbook
 * entirely rather than shipped as columns people get wrong.
 */
export type MasterColumn = 'shelter_type';

export const MASTER_COLUMNS: readonly MasterColumn[] = ['shelter_type'];

/** Shelter fields intentionally absent from the workbook — documented on the README sheet. */
export const APP_ONLY_FIELDS: readonly string[] = [
	'โซนเทศบาล',
	'ชุมชน',
	'กลุ่มเปราะบางที่ศูนย์รองรับได้'
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
	 * Dotted path into the shelter payload, used to map a Zod issue back to this
	 * column. Omitted for columns the validator assembles by hand (sub-storage,
	 * pet categories, parking vehicles) or that are not payload fields (`ref`).
	 */
	path?: string;
	/** short helper text for the README sheet. */
	hint: string;
}

export interface SheetDef {
	/** Worksheet name. */
	name: string;
	/**
	 * `shelter` sheets are 1:1 and merged into one row by {@link H.ref};
	 * `zone` sheets are N:1 and stay as repeated rows.
	 */
	kind: 'shelter' | 'zone';
	columns: readonly ColumnDef[];
	/** Header text of this sheet's join key — the `isRef` column's header. */
	refHeader: string;
	/** Shown at the top of the README section for this sheet. */
	description: string;
}

/** The join-key column of a 1:1 shelter sheet. */
const refColumn: ColumnDef = {
	header: H.ref,
	kind: 'number',
	required: true,
	isRef: true,
	hint: 'เลขอ้างอิงศูนย์ — ต้องตรงกันทุกชีต (ชีต "ข้อมูลศูนย์" คือตัวตั้ง)'
};

/** The same join key on the zone sheet, pointing at the shelter it belongs to. */
const zoneRefColumn: ColumnDef = {
	header: H.zone_shelter_ref,
	kind: 'number',
	required: true,
	isRef: true,
	hint: `เลข "${H.ref}" ของศูนย์ที่โซนนี้สังกัด (ดูจากชีต "ข้อมูลศูนย์") — ไม่ใช่ลำดับของโซน`
};

const SHEET_MAIN: SheetDef = {
	name: 'ข้อมูลศูนย์',
	kind: 'shelter',
	refHeader: H.ref,
	description: 'หนึ่งแถว = หนึ่งศูนย์พักพิง — ชีตนี้เป็นตัวตั้งของ "ลำดับที่"',
	columns: [
		refColumn,
		{
			header: H.name,
			kind: 'string',
			required: true,
			path: 'name',
			hint: 'ชื่อศูนย์พักพิง (จำเป็น)'
		},
		{
			header: H.operation_status,
			kind: 'enum',
			required: false,
			choices: OPERATION_STATUS_CHOICES,
			path: 'operation_status',
			hint: 'สถานะการเปิดให้บริการ (ว่าง = เตรียมพร้อม)'
		},
		{
			header: H.shelter_type,
			kind: 'masterdata',
			required: false,
			masterType: 'shelter_type',
			path: 'shelter_type',
			hint: 'เลือกจากรายการประเภทศูนย์พักพิง'
		},
		{
			header: H.project_level,
			kind: 'enum',
			required: false,
			choices: PROJECT_LEVEL_CHOICES,
			path: 'project_level',
			hint: 'ระดับโครงการของศูนย์'
		},
		{
			header: H.area_type,
			kind: 'enum',
			required: false,
			choices: AREA_TYPE_CHOICES,
			path: 'area_type',
			hint: 'สถานะพื้นที่อาคาร'
		},
		{
			header: H.capacity,
			kind: 'number',
			required: true,
			path: 'capacity',
			hint: 'ความจุสูงสุด (คน) — จำนวนเต็มมากกว่า 0 (จำเป็น)'
		},
		{
			header: H.area_m2,
			kind: 'number',
			required: false,
			path: 'area_m2',
			hint: 'พื้นที่ใช้สอยรวม (ตร.ม.)'
		},
		{
			header: H.address,
			kind: 'string',
			required: false,
			path: 'location.address',
			hint: 'ที่อยู่แบบข้อความเต็ม'
		},
		{
			header: H.lat,
			kind: 'number',
			required: false,
			path: 'location.lat',
			hint: 'ละติจูด (-90 ถึง 90)'
		},
		{
			header: H.lng,
			kind: 'number',
			required: false,
			path: 'location.lng',
			hint: 'ลองจิจูด (-180 ถึง 180)'
		},
		{
			header: H.address_no,
			kind: 'string',
			required: false,
			path: 'address_no',
			hint: 'บ้านเลขที่'
		},
		{ header: H.village_no, kind: 'string', required: false, path: 'village_no', hint: 'หมู่ที่' },
		{ header: H.province, kind: 'string', required: false, path: 'province', hint: 'จังหวัด' },
		{ header: H.district, kind: 'string', required: false, path: 'district', hint: 'อำเภอ/เขต' },
		{
			header: H.subdistrict,
			kind: 'string',
			required: false,
			path: 'subdistrict',
			hint: 'ตำบล/แขวง'
		},
		{
			header: H.postal_code,
			kind: 'string',
			required: false,
			path: 'postal_code',
			hint: 'รหัสไปรษณีย์'
		},
		{
			header: H.contact_name,
			kind: 'string',
			required: false,
			path: 'contact.name',
			hint: 'ชื่อผู้จัดการศูนย์'
		},
		{
			header: H.contact_phone,
			kind: 'string',
			required: false,
			path: 'contact.phone',
			hint: 'เบอร์โทรผู้จัดการศูนย์'
		},
		{
			header: H.eoc_liaison_name,
			kind: 'string',
			required: false,
			path: 'key_personnel.eoc_liaison.name',
			hint: 'ชื่อผู้ประสานงานกับ EOC'
		},
		{
			header: H.eoc_liaison_phone,
			kind: 'string',
			required: false,
			path: 'key_personnel.eoc_liaison.phone',
			hint: 'เบอร์โทรผู้ประสานงาน EOC'
		},
		{
			header: H.medical_lead_name,
			kind: 'string',
			required: false,
			path: 'key_personnel.medical_lead.name',
			hint: 'ชื่อหัวหน้าฝ่ายพยาบาล'
		},
		{
			header: H.medical_lead_phone,
			kind: 'string',
			required: false,
			path: 'key_personnel.medical_lead.phone',
			hint: 'เบอร์โทรหัวหน้าฝ่ายพยาบาล'
		},
		{
			header: H.kitchen_lead_name,
			kind: 'string',
			required: false,
			path: 'key_personnel.kitchen_lead.name',
			hint: 'ชื่อหัวหน้าฝ่ายครัว'
		},
		{
			header: H.kitchen_lead_phone,
			kind: 'string',
			required: false,
			path: 'key_personnel.kitchen_lead.phone',
			hint: 'เบอร์โทรหัวหน้าฝ่ายครัว'
		}
	]
};

const SHEET_FACILITIES: SheetDef = {
	name: 'สิ่งอำนวยความสะดวก',
	kind: 'shelter',
	refHeader: H.ref,
	description: 'สุขาภิบาลและพื้นที่ส่วนกลาง — หนึ่งแถวต่อหนึ่งศูนย์ (ปล่อยว่างได้ทั้งแถว)',
	columns: [
		refColumn,
		{
			header: H.toilets_male,
			kind: 'number',
			required: false,
			path: 'facilities.toilets_male',
			hint: 'จำนวนห้องน้ำชาย'
		},
		{
			header: H.toilets_female,
			kind: 'number',
			required: false,
			path: 'facilities.toilets_female',
			hint: 'จำนวนห้องน้ำหญิง'
		},
		{
			header: H.toilets_accessible,
			kind: 'number',
			required: false,
			path: 'facilities.toilets_accessible',
			hint: 'จำนวนห้องน้ำสำหรับผู้พิการ/ผู้สูงอายุ'
		},
		{
			header: H.showers,
			kind: 'number',
			required: false,
			path: 'facilities.showers',
			hint: 'จำนวนห้องอาบน้ำ'
		},
		{
			header: H.water_points,
			kind: 'number',
			required: false,
			path: 'facilities.water_points',
			hint: 'จำนวนจุดจ่ายน้ำ'
		},
		{
			header: H.handwashing_stations,
			kind: 'number',
			required: false,
			path: 'facilities.handwashing_stations',
			hint: 'จำนวนจุดล้างมือ'
		},
		{
			header: H.car_toilet_accessible,
			kind: 'boolean',
			required: false,
			choices: BOOLEAN_CHOICES,
			path: 'facilities.car_toilet_accessible',
			hint: 'พื้นที่รองรับรถสุขาเคลื่อนที่เข้าถึงได้หรือไม่'
		},
		{
			header: H.car_toilet_supported,
			kind: 'number',
			required: false,
			path: 'facilities.car_toilet_supported',
			hint: 'จำนวนรถสุขาที่รองรับ — กรอกได้เมื่อรองรับรถสุขา = ใช่ (ไม่เช่นนั้นระบบจะล้างค่า)'
		},
		{
			header: H.central_kitchen,
			kind: 'boolean',
			required: false,
			choices: BOOLEAN_CHOICES,
			path: 'common_areas.central_kitchen',
			hint: 'มีโรงครัวกลางหรือไม่'
		},
		{
			header: H.helipad,
			kind: 'boolean',
			required: false,
			choices: BOOLEAN_CHOICES,
			path: 'common_areas.helipad',
			hint: 'มีลานจอดเฮลิคอปเตอร์หรือไม่'
		},
		{
			header: H.isolation_room,
			kind: 'boolean',
			required: false,
			choices: BOOLEAN_CHOICES,
			path: 'common_areas.isolation_room',
			hint: 'มีห้อง/พื้นที่แยกกักโรคหรือไม่'
		},
		{
			header: H.women_child_friendly_space,
			kind: 'boolean',
			required: false,
			choices: BOOLEAN_CHOICES,
			path: 'common_areas.women_child_friendly_space',
			hint: 'มีพื้นที่ปลอดภัยสำหรับสตรีและเด็กหรือไม่'
		},
		{
			header: H.parking_capacity,
			kind: 'number',
			required: false,
			path: 'common_areas.parking_capacity',
			hint: 'ความจุที่จอดรถรวม (คัน)'
		},
		{
			header: H.logistics_area_m2,
			kind: 'number',
			required: false,
			path: 'common_areas.logistics_area_m2',
			hint: 'พื้นที่รับ-ส่งของบริจาค/โลจิสติกส์ (ตร.ม.)'
		},
		{
			header: H.sub_storage,
			kind: 'string',
			required: false,
			hint: `รายการคลังย่อย รูปแบบ ชื่อ${FIELD_SEPARATOR}ประเภท${FIELD_SEPARATOR}พื้นที่ คั่นแต่ละรายการด้วย "${MULTI_SEPARATOR}" เช่น คลังหน้าอาคาร${FIELD_SEPARATOR}อาหารแห้ง${FIELD_SEPARATOR}20 ${MULTI_SEPARATOR} คลังยา${FIELD_SEPARATOR}เวชภัณฑ์${FIELD_SEPARATOR}8`
		}
	]
};

const SHEET_UTILITIES: SheetDef = {
	name: 'สาธารณูปโภคและความเสี่ยง',
	kind: 'shelter',
	refHeader: H.ref,
	description: 'ระบบพื้นฐานและข้อมูลความเสี่ยงสำหรับ EOC — หนึ่งแถวต่อหนึ่งศูนย์',
	columns: [
		refColumn,
		{
			header: H.power_source,
			kind: 'enum',
			required: false,
			choices: POWER_SOURCE_CHOICES,
			path: 'utilities.power_source',
			hint: 'แหล่งพลังงานหลักของศูนย์'
		},
		{
			header: H.water_source,
			kind: 'enum',
			required: false,
			choices: WATER_SOURCE_CHOICES,
			path: 'utilities.water_source',
			hint: 'แหล่งน้ำหลักของศูนย์'
		},
		...COMMUNICATION_COLUMNS.map(({ header, label }): ColumnDef => ({
			header,
			kind: 'boolean',
			required: false,
			choices: BOOLEAN_CHOICES,
			hint: `ศูนย์ใช้ ${label} ได้หรือไม่`
		})),
		{
			header: H.vhf_channel,
			kind: 'string',
			required: false,
			path: 'utilities.vhf_channel',
			hint: 'ระบุได้ต่อเมื่อ "มีวิทยุสื่อสาร VHF" = ใช่ แล้วเท่านั้น'
		},
		{
			header: H.elevation_m,
			kind: 'number',
			required: false,
			path: 'risk.elevation_m',
			hint: 'ความสูงของพื้นที่จากระดับน้ำทะเล (เมตร)'
		},
		{
			header: H.entrance_description,
			kind: 'string',
			required: false,
			path: 'risk.entrance_description',
			hint: 'ลักษณะทางเข้า-ออก เช่น ถนนแคบ รถใหญ่เข้าไม่ได้'
		},
		{
			header: H.constraints,
			kind: 'string',
			required: false,
			path: 'risk.constraints',
			hint: 'ข้อจำกัด/ความเสี่ยงอื่นของพื้นที่'
		},
		{
			header: H.secondary_muster_point,
			kind: 'string',
			required: false,
			path: 'risk.secondary_muster_point',
			hint: 'จุดรวมพลสำรองกรณีต้องอพยพซ้อน'
		}
	]
};

const SHEET_POLICY: SheetDef = {
	name: 'นโยบาย',
	kind: 'shelter',
	refHeader: H.ref,
	description: 'นโยบายการรับเข้า สัตว์เลี้ยง สัมภาระ และที่จอดรถ — หนึ่งแถวต่อหนึ่งศูนย์',
	columns: [
		refColumn,
		{
			header: H.pet_policy,
			kind: 'enum',
			required: false,
			choices: PET_POLICY_CHOICES,
			path: 'admission_policy.pet_policy.policy',
			hint: 'นโยบายรับสัตว์เลี้ยง — เลือก "ไม่อนุญาต" แล้วเงื่อนไขทุกช่องจะถูกล้าง'
		},
		...PET_CONDITION_COLUMNS.map(({ header, label }): ColumnDef => ({
			header,
			kind: 'boolean',
			required: false,
			choices: BOOLEAN_CHOICES,
			hint: label
		})),
		{
			header: H.pet_small_other,
			kind: 'string',
			required: false,
			hint: 'เงื่อนไขเพิ่มเติมสำหรับสัตว์เลี้ยงขนาดเล็ก'
		},
		{
			header: H.pet_large_other,
			kind: 'string',
			required: false,
			hint: 'เงื่อนไขเพิ่มเติมสำหรับสุนัขขนาดใหญ่'
		},
		{
			header: H.pet_livestock_other,
			kind: 'string',
			required: false,
			hint: 'เงื่อนไขเพิ่มเติมสำหรับปศุสัตว์'
		},
		{
			header: H.pet_livestock_capacity,
			kind: 'number',
			required: false,
			hint: 'จำนวนปศุสัตว์สูงสุดที่รองรับ (ตัว)'
		},
		{
			header: H.pet_livestock_location,
			kind: 'string',
			required: false,
			hint: 'จุด/พื้นที่ที่จัดไว้รองรับปศุสัตว์'
		},
		{
			header: H.luggage_limitation,
			kind: 'enum',
			required: false,
			choices: LUGGAGE_LIMITATION_CHOICES,
			path: 'luggage_policy.limitation',
			hint: 'จำกัดปริมาณสัมภาระหรือไม่'
		},
		{
			header: H.luggage_max_per_family,
			kind: 'number',
			required: false,
			path: 'luggage_policy.max_per_family',
			hint: 'กรอกได้เมื่อเลือก "จำกัดปริมาณสัมภาระ" (ไม่เช่นนั้นระบบจะล้างค่า)'
		},
		{
			header: H.luggage_rules,
			kind: 'multi-enum',
			required: false,
			choices: LUGGAGE_RULE_CHOICES,
			path: 'luggage_policy.rules',
			hint: 'กฎมาตรฐานเรื่องสัมภาระ/ทรัพย์สิน'
		},
		{
			header: H.luggage_rules_other,
			kind: 'string',
			required: false,
			path: 'luggage_policy.rules_other',
			hint: 'กฎเรื่องสัมภาระเพิ่มเติมที่ไม่อยู่ในรายการ'
		},
		{
			header: H.parking_availability,
			kind: 'enum',
			required: false,
			choices: PARKING_AVAILABILITY_CHOICES,
			path: 'parking_policy.availability',
			hint: 'ศูนย์มีพื้นที่จอดรถหรือไม่'
		},
		{
			header: H.park_motorcycle,
			kind: 'number',
			required: false,
			hint: 'จำนวนรถจักรยานยนต์ที่รองรับ — กรอกได้เมื่อ "มีพื้นที่จอดรถ"'
		},
		{
			header: H.park_car,
			kind: 'number',
			required: false,
			hint: 'จำนวนรถยนต์/กระบะที่รองรับ — กรอกได้เมื่อ "มีพื้นที่จอดรถ"'
		},
		{
			header: H.park_truck,
			kind: 'number',
			required: false,
			hint: 'จำนวนรถบรรทุกที่รองรับ — กรอกได้เมื่อ "มีพื้นที่จอดรถ"'
		},
		{
			header: H.park_boat,
			kind: 'number',
			required: false,
			hint: 'จำนวนเรือที่รองรับ — กรอกได้เมื่อ "มีพื้นที่จอดรถ"'
		},
		{
			header: H.parking_rules,
			kind: 'multi-enum',
			required: false,
			choices: PARKING_RULE_CHOICES,
			path: 'parking_policy.rules',
			hint: 'กฎมาตรฐานเรื่องที่จอดรถ'
		},
		{
			header: H.parking_rules_other,
			kind: 'string',
			required: false,
			path: 'parking_policy.rules_other',
			hint: 'กฎเรื่องที่จอดรถเพิ่มเติมที่ไม่อยู่ในรายการ'
		}
	]
};

const SHEET_ZONES: SheetDef = {
	name: 'โซน',
	kind: 'zone',
	refHeader: H.zone_shelter_ref,
	description: `หนึ่งแถว = หนึ่งโซน — ศูนย์หนึ่งแห่งมีได้หลายแถว ผูกกลับด้วย "${H.zone_shelter_ref}" ซึ่งคือเลข "${H.ref}" ของชีตข้อมูลศูนย์`,
	columns: [
		zoneRefColumn,
		{
			header: H.zone_code,
			kind: 'string',
			required: true,
			path: 'code',
			hint: 'รหัสโซน เช่น A, B (จำเป็น และห้ามซ้ำภายในศูนย์เดียวกัน)'
		},
		{ header: H.zone_name, kind: 'string', required: true, path: 'name', hint: 'ชื่อโซน (จำเป็น)' },
		{
			header: H.zone_capacity,
			kind: 'number',
			required: true,
			path: 'capacity',
			hint: 'ความจุของโซน (คน) — จำนวนเต็มมากกว่า 0 (จำเป็น)'
		},
		{
			header: H.zone_type,
			kind: 'enum',
			required: false,
			choices: ZONE_TYPE_CHOICES,
			path: 'type',
			hint: 'ประเภทโซน (ว่าง = ทั่วไป)'
		},
		{
			header: H.zone_status,
			kind: 'enum',
			required: false,
			choices: ZONE_STATUS_CHOICES,
			path: 'status',
			hint: 'สถานะโซน (ว่าง = เปิดใช้งาน)'
		},
		{
			header: H.zone_area_m2,
			kind: 'number',
			required: false,
			path: 'area_m2',
			hint: 'พื้นที่ของโซน (ตร.ม.)'
		},
		{
			header: H.zone_specifics,
			kind: 'string',
			required: false,
			path: 'specifics',
			hint: 'รายละเอียด/ข้อสังเกตของโซน'
		}
	]
};

/** Workbook layout, in tab order. */
export const SHEETS: readonly SheetDef[] = [
	SHEET_MAIN,
	SHEET_FACILITIES,
	SHEET_UTILITIES,
	SHEET_POLICY,
	SHEET_ZONES
];

export const MAIN_SHEET_NAME = SHEET_MAIN.name;
export const ZONE_SHEET_NAME = SHEET_ZONES.name;

/** The 1:1 sheets the parser merges into a single row per shelter. */
export const SHELTER_SHEETS: readonly SheetDef[] = SHEETS.filter((s) => s.kind === 'shelter');

/** Every shelter-level column, flattened across the 1:1 sheets (excludes the join key). */
export const COLUMNS: readonly ColumnDef[] = SHELTER_SHEETS.flatMap((s) =>
	s.columns.filter((c) => !c.isRef)
);

/** Header texts in column order — used by the parser to map cells → keys. */
export const COLUMN_HEADERS: readonly string[] = COLUMNS.map((c) => c.header);

export const ZONE_COLUMNS: readonly ColumnDef[] = SHEET_ZONES.columns.filter((c) => !c.isRef);

/** header → sheet name, so an error can tell the user which tab to open. */
export const HEADER_TO_SHEET: Readonly<Record<string, string>> = Object.fromEntries(
	SHEETS.flatMap((s) => s.columns.map((c) => [c.header, s.name] as const))
);

/** Dotted payload path → Thai header, derived from `ColumnDef.path` (no drift). */
export const PATH_TO_HEADER: Readonly<Record<string, string>> = Object.fromEntries(
	COLUMNS.filter((c) => c.path).map((c) => [c.path!, c.header] as const)
);

/** Same, for one zone entry (paths are relative to the zone object). */
export const ZONE_PATH_TO_HEADER: Readonly<Record<string, string>> = Object.fromEntries(
	ZONE_COLUMNS.filter((c) => c.path).map((c) => [c.path!, c.header] as const)
);
