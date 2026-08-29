import {
	CARD_TYPE_CHOICES,
	GENDER_CHOICES,
	H,
	RELIGION_CHOICES,
	ROLE_CHOICES,
	SPECIAL_NEED_CHOICES,
	type EnumChoice
} from '../domain/columns';
import type { TemplateMasters } from './template';

/**
 * A realistic, ready-to-import example household (CR-071 slice A / T-72) —
 * written into the template when the user opts into a pre-filled download, so
 * the blank column headers aren't the first thing they see.
 *
 * Values here MUST pass `validateRow` cleanly (see `sample-row.test.ts`) — this
 * module is pinned against the real validator, not just eyeballed. Every enum
 * cell uses the exact label text from `domain/columns.ts` so it matches the
 * workbook's dropdowns.
 */

/** Cell values for the example household, keyed by Thai column header. */
export interface SampleWorkbook {
	/** header → value, covering both 1:1 sheets. A missing key leaves the cell blank. */
	household: Record<string, string | number>;
	/** one entry per member row, header → value. */
	members: Record<string, string | number>[];
}

/** Look up a choice's label by its value — throws on drift instead of silently mismatching. */
function labelOf<T extends string>(choices: readonly EnumChoice<T>[], value: T): string {
	const found = choices.find((c) => c.value === value);
	if (!found) throw new Error(`sample-row: no choice for value "${value}"`);
	return found.label;
}

/** Build the example household's cell values, resolving master-data labels from `masters`. */
export function buildSampleWorkbook(masters: TemplateMasters): SampleWorkbook {
	const zoneLabel = masters.municipality_zone[0]?.label;
	const communityLabel = masters.community[0]?.label;

	const household: Record<string, string | number> = {
		[H.label]: 'ครอบครัวสมชาย ใจดี',
		[H.card_type]: labelOf(CARD_TYPE_CHOICES, 'national_id'),
		[H.id_number]: '1234567890123',
		[H.first_name]: 'สมชาย',
		[H.last_name]: 'ใจดี',
		[H.nickname]: 'ชาย',
		[H.gender]: labelOf(GENDER_CHOICES, 'male'),
		[H.birth_year]: 2520,
		[H.phone]: '0812345678',
		[H.country]: 'THAILAND',
		[H.religion]: labelOf(RELIGION_CHOICES, 'buddhist'),
		[H.medical_conditions]: 'ความดันโลหิตสูง',
		[H.medical_medications]: 'ยาลดความดัน',
		[H.emergency_name]: 'สมหญิง ใจดี',
		[H.emergency_phone]: '0898765432',
		[H.emergency_relation]: 'คู่สมรส',
		[H.address_no]: '99/1',
		[H.village_no]: '4',
		[H.subdistrict]: 'ในเมือง',
		[H.district]: 'เมือง',
		[H.province]: 'เชียงราย',
		[H.postal_code]: '57000',
		[H.pets]: 'สุนัข:1:มีกรงและสมุดวัคซีน',
		[H.vehicles]: 'รถจักรยานยนต์:กข 1234',
		[H.assets]: 'กระเป๋าเสื้อผ้า 2 ใบ',
		[H.notes]: 'บ้านน้ำท่วมถึงชั้นล่าง'
	};
	// Master-data lists are per shelter — only pre-fill them when the shelter
	// actually has options, otherwise the sample row would fail its own import.
	if (zoneLabel) household[H.municipality_zone] = zoneLabel;
	if (communityLabel) household[H.community] = communityLabel;

	const members: Record<string, string | number>[] = [
		{
			[H.card_type]: labelOf(CARD_TYPE_CHOICES, 'national_id'),
			[H.id_number]: '1234567890124',
			[H.first_name]: 'สมหญิง',
			[H.last_name]: 'ใจดี',
			[H.gender]: labelOf(GENDER_CHOICES, 'female'),
			[H.birth_year]: 2525,
			[H.phone]: '0898765432',
			[H.religion]: labelOf(RELIGION_CHOICES, 'buddhist')
		},
		{
			[H.id_number]: '1234567890125',
			[H.first_name]: 'สมศรี',
			[H.last_name]: 'ใจดี',
			[H.gender]: labelOf(GENDER_CHOICES, 'female'),
			[H.birth_year]: 2560,
			[H.phone]: 'ไม่มี',
			[H.special_needs]: labelOf(SPECIAL_NEED_CHOICES, 'infant')
		},
		{
			[H.id_number]: '1234567890126',
			[H.first_name]: 'สมปอง',
			[H.last_name]: 'ใจดี',
			[H.gender]: labelOf(GENDER_CHOICES, 'male'),
			[H.birth_year]: 2488,
			[H.phone]: 'ไม่มี',
			[H.special_needs]: `${labelOf(SPECIAL_NEED_CHOICES, 'elderly')} | ${labelOf(SPECIAL_NEED_CHOICES, 'chronic_illness')}`,
			[H.medical_conditions]: 'เบาหวาน',
			[H.medical_allergies]: 'เพนิซิลลิน'
		}
	];

	return { household, members };
}

/** The same example as flat CSV rows — one row per person, head first. */
export function buildSampleCsvRows(masters: TemplateMasters): Record<string, string | number>[] {
	const { household, members } = buildSampleWorkbook(masters);
	const headRole = labelOf(ROLE_CHOICES, 'head');
	const memberRole = labelOf(ROLE_CHOICES, 'member');
	return [
		{ [H.ref]: 1, [H.role]: headRole, ...household },
		...members.map((m) => ({ [H.ref]: 1, [H.role]: memberRole, ...m }))
	];
}
