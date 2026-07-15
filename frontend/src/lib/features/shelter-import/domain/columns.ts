import type { AreaType, OperationStatus, ProjectLevel } from '$lib/features/shelters';

/**
 * Column contract for the shelter Excel import (CR-039).
 *
 * Single source of truth shared by the template generator, the xlsx parser and
 * the row validator — header text (Thai) IS the key, so all three layers agree
 * without drift. Enum labels mirror the shelter form (basic-info-section /
 * capacity-section) so a downloaded template reads the same as the app.
 *
 * Pure / isomorphic: no I/O, no Svelte. Values come from `shelterSchema`
 * (features/shelters). Master-data choices (municipality_zone / community) are
 * injected at runtime — the domain only knows they resolve label → code.
 */

export interface EnumChoice<T extends string = string> {
	value: T;
	label: string;
}

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

/** Thai header text per column — the stable key used across template/parse/validate. */
export const H = {
	name: 'ชื่อศูนย์พักพิง',
	operation_status: 'สถานะ',
	project_level: 'ระดับโครงการ',
	address: 'ที่อยู่ตามเขตการปกครอง',
	lat: 'ละติจูด',
	lng: 'ลองจิจูด',
	municipality_zone: 'โซนเทศบาล',
	community: 'ชุมชน',
	address_no: 'บ้านเลขที่',
	village_no: 'หมู่ที่',
	province: 'จังหวัด',
	district: 'อำเภอ/เขต',
	subdistrict: 'ตำบล/แขวง',
	postal_code: 'รหัสไปรษณีย์',
	contact_name: 'ผู้จัดการศูนย์',
	contact_phone: 'เบอร์โทรผู้จัดการศูนย์',
	capacity: 'ความจุสูงสุด (คน)',
	area_m2: 'พื้นที่ใช้สอยรวม (ตร.ม.)',
	area_type: 'สถานะพื้นที่อาคาร'
} as const;

export type ColumnKind = 'string' | 'number' | 'enum' | 'masterdata';
export type MasterColumn = 'municipality_zone' | 'community';

export interface ColumnDef {
	/** Thai header text — the key. */
	header: string;
	kind: ColumnKind;
	required: boolean;
	/** enum columns only — the fixed whitelist. */
	choices?: readonly EnumChoice[];
	/** masterdata columns only — which master_data type supplies the options. */
	masterType?: MasterColumn;
	/** short helper text for the README sheet. */
	hint: string;
}

/** Ordered 19-column contract (order = template column order). */
export const COLUMNS: readonly ColumnDef[] = [
	{ header: H.name, kind: 'string', required: true, hint: 'ชื่อศูนย์พักพิง (จำเป็น)' },
	{
		header: H.operation_status,
		kind: 'enum',
		required: false,
		choices: OPERATION_STATUS_CHOICES,
		hint: 'สถานะการเปิดให้บริการ (ว่าง = เตรียมพร้อม)'
	},
	{
		header: H.project_level,
		kind: 'enum',
		required: false,
		choices: PROJECT_LEVEL_CHOICES,
		hint: 'ระดับโครงการของศูนย์'
	},
	{ header: H.address, kind: 'string', required: false, hint: 'ที่อยู่แบบข้อความเต็ม' },
	{ header: H.lat, kind: 'number', required: false, hint: 'ละติจูด (-90 ถึง 90)' },
	{ header: H.lng, kind: 'number', required: false, hint: 'ลองจิจูด (-180 ถึง 180)' },
	{
		header: H.municipality_zone,
		kind: 'masterdata',
		required: false,
		masterType: 'municipality_zone',
		hint: 'เลือกจากรายการโซนเทศบาล'
	},
	{
		header: H.community,
		kind: 'masterdata',
		required: false,
		masterType: 'community',
		hint: 'เลือกจากรายการชุมชน'
	},
	{ header: H.address_no, kind: 'string', required: false, hint: 'บ้านเลขที่' },
	{ header: H.village_no, kind: 'string', required: false, hint: 'หมู่ที่' },
	{ header: H.province, kind: 'string', required: false, hint: 'จังหวัด' },
	{ header: H.district, kind: 'string', required: false, hint: 'อำเภอ/เขต' },
	{ header: H.subdistrict, kind: 'string', required: false, hint: 'ตำบล/แขวง' },
	{ header: H.postal_code, kind: 'string', required: false, hint: 'รหัสไปรษณีย์' },
	{ header: H.contact_name, kind: 'string', required: false, hint: 'ชื่อผู้จัดการศูนย์' },
	{ header: H.contact_phone, kind: 'string', required: false, hint: 'เบอร์โทรผู้จัดการศูนย์' },
	{
		header: H.capacity,
		kind: 'number',
		required: true,
		hint: 'ความจุสูงสุด (คน) — จำนวนเต็มมากกว่า 0 (จำเป็น)'
	},
	{ header: H.area_m2, kind: 'number', required: false, hint: 'พื้นที่ใช้สอยรวม (ตร.ม.)' },
	{
		header: H.area_type,
		kind: 'enum',
		required: false,
		choices: AREA_TYPE_CHOICES,
		hint: 'สถานะพื้นที่อาคาร'
	}
];

/** Header texts in column order — used by the parser to map cells → keys. */
export const COLUMN_HEADERS: readonly string[] = COLUMNS.map((c) => c.header);
