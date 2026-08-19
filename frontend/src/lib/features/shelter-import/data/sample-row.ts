import {
	AREA_TYPE_CHOICES,
	H,
	LUGGAGE_LIMITATION_CHOICES,
	LUGGAGE_RULE_CHOICES,
	OPERATION_STATUS_CHOICES,
	PARKING_AVAILABILITY_CHOICES,
	PARKING_RULE_CHOICES,
	PET_CONDITION_COLUMNS,
	PET_POLICY_CHOICES,
	POWER_SOURCE_CHOICES,
	PROJECT_LEVEL_CHOICES,
	SUB_STORAGE_TYPE_CHOICES,
	WATER_SOURCE_CHOICES,
	ZONE_STATUS_CHOICES,
	ZONE_TYPE_CHOICES,
	type EnumChoice
} from '../domain/columns';
import type { TemplateMasters } from './template';

/**
 * A realistic, ready-to-import example shelter (CR-039 extension) — written
 * into the template workbook when the user opts into a pre-filled download so
 * the blank column headers aren't the first thing they see.
 *
 * Values here MUST pass `validateRow` cleanly (see `sample-row.test.ts`) — this
 * module is pinned against the real validator, not just eyeballed. Every
 * enum/boolean cell uses the exact label text from `domain/columns.ts` so it
 * matches the workbook's dropdowns.
 */

/** Cell values for the example shelter, keyed by Thai column header. */
export interface SampleWorkbook {
	/** header -> value, covering all four 1:1 sheets. A missing key means the cell is left blank. */
	shelter: Record<string, string | number>;
	/** one entry per zone row, header -> value. */
	zones: Record<string, string | number>[];
}

/** Look up a choice's label by its value — throws on drift instead of silently mismatching. */
function labelOf<T extends string>(choices: readonly EnumChoice<T>[], value: T): string {
	const found = choices.find((c) => c.value === value);
	if (!found) throw new Error(`sample-row: no choice for value "${value}"`);
	return found.label;
}

function petConditionHeader(value: string): string {
	const found = PET_CONDITION_COLUMNS.find((c) => c.value === value);
	if (!found) throw new Error(`sample-row: no pet condition column for "${value}"`);
	return found.header;
}

const YES = 'ใช่';
const NO = 'ไม่ใช่';

/** Build the example shelter's cell values, resolving master-data labels from `masters`. */
export function buildSampleWorkbook(masters: TemplateMasters): SampleWorkbook {
	const shelterTypeLabel = masters.shelter_type[0]?.label;

	const shelter: Record<string, string | number> = {
		[H.name]: 'โรงเรียนบ้านคอหงส์',
		[H.operation_status]: labelOf(OPERATION_STATUS_CHOICES, 'active'),
		...(shelterTypeLabel ? { [H.shelter_type]: shelterTypeLabel } : {}),
		[H.project_level]: labelOf(PROJECT_LEVEL_CHOICES, 'lao'),
		[H.area_type]: labelOf(AREA_TYPE_CHOICES, 'indoor'),
		[H.capacity]: 150,
		[H.area_m2]: 1200,
		[H.address]: '99/1 หมู่ที่ 3 ตำบลคอหงส์ อำเภอหาดใหญ่ จังหวัดสงขลา 90110',
		[H.lat]: 7.0086,
		[H.lng]: 100.4747,
		[H.address_no]: '99/1',
		[H.village_no]: '3',
		[H.province]: 'สงขลา',
		[H.district]: 'หาดใหญ่',
		[H.subdistrict]: 'คอหงส์',
		[H.postal_code]: '90110',
		[H.contact_name]: 'สมชาย ใจดี',
		[H.contact_phone]: '0812345678',
		[H.eoc_liaison_name]: 'สมหญิง รักชาติ',
		[H.eoc_liaison_phone]: '0823456789',
		[H.medical_lead_name]: 'พยาบาลสมศรี แข็งแรง',
		[H.medical_lead_phone]: '0834567890',
		[H.kitchen_lead_name]: 'แม่ครัวสมใจ อิ่มบุญ',
		[H.kitchen_lead_phone]: '0845678901',

		// -- สิ่งอำนวยความสะดวก --
		[H.toilets_male]: 5,
		[H.toilets_female]: 6,
		[H.toilets_accessible]: 2,
		[H.showers]: 8,
		[H.water_points]: 4,
		[H.handwashing_stations]: 6,
		// car_toilet_supported only counts when car_toilet_accessible = ใช่
		[H.car_toilet_accessible]: YES,
		[H.car_toilet_supported]: 2,
		[H.central_kitchen]: YES,
		[H.helipad]: NO,
		[H.isolation_room]: YES,
		[H.women_child_friendly_space]: YES,
		[H.parking_capacity]: 40,
		[H.logistics_area_m2]: 100,
		[H.sub_storage]: `คลังหน้าอาคาร:${labelOf(SUB_STORAGE_TYPE_CHOICES, 'food_dry')}:20 | คลังยา:${labelOf(SUB_STORAGE_TYPE_CHOICES, 'medical_supplies')}:8`,

		// -- สาธารณูปโภคและความเสี่ยง --
		[H.power_source]: labelOf(POWER_SOURCE_CHOICES, 'city_grid'),
		[H.water_source]: labelOf(WATER_SOURCE_CHOICES, 'city_water'),
		[H.comm_cellular]: YES,
		[H.comm_wifi]: YES,
		// vhf_channel only counts when comm_vhf = ใช่
		[H.comm_vhf]: YES,
		[H.vhf_channel]: 'ช่อง 16',
		[H.elevation_m]: 12,
		[H.entrance_description]: 'ทางเข้าหลักกว้าง 6 เมตร รถบรรทุกเข้า-ออกได้สะดวก',
		[H.constraints]: 'พื้นที่บางส่วนเป็นที่ลุ่ม เสี่ยงน้ำท่วมขังช่วงฝนตกหนัก',
		[H.secondary_muster_point]: 'ลานกีฬาเทศบาลนครหาดใหญ่',

		// -- นโยบาย --
		[H.pet_policy]: labelOf(PET_POLICY_CHOICES, 'conditional'),
		// a couple of pet conditions set to ใช่ (only counted since pet_policy = conditional)
		[petConditionHeader('bring_own_cage')]: YES,
		[petConditionHeader('muzzle_and_leash')]: YES,
		[H.pet_small_other]: 'อนุญาตเฉพาะสัตว์เลี้ยงที่ไม่ก้าวร้าวและควบคุมได้',
		[H.pet_livestock_capacity]: 5,
		[H.pet_livestock_location]: 'ลานหลังอาคารเรียน',
		// luggage_max_per_family only counts when luggage_limitation = limited
		[H.luggage_limitation]: labelOf(LUGGAGE_LIMITATION_CHOICES, 'limited'),
		[H.luggage_max_per_family]: 3,
		[H.luggage_rules]: [
			labelOf(LUGGAGE_RULE_CHOICES, 'valuables_self_responsibility'),
			labelOf(LUGGAGE_RULE_CHOICES, 'has_temp_storage_service')
		].join(' | '),
		[H.luggage_rules_other]: 'ของมีค่าฝากไว้ที่จุดรับฝากทรัพย์สินได้',
		// park_* counts only when parking_availability = available (Parking Available)
		[H.parking_availability]: labelOf(PARKING_AVAILABILITY_CHOICES, 'available'),
		[H.park_motorcycle]: 20,
		[H.park_car]: 15,
		[H.park_truck]: 3,
		[H.parking_rules]: [
			labelOf(PARKING_RULE_CHOICES, 'no_liability'),
			labelOf(PARKING_RULE_CHOICES, 'first_come_first_served')
		].join(' | '),
		[H.parking_rules_other]: 'รถต้องจอดในผังที่กำหนดเท่านั้น'
	};

	const zones: Record<string, string | number>[] = [
		{
			[H.zone_code]: 'A',
			[H.zone_name]: 'โซน A - ครอบครัวทั่วไป',
			[H.zone_capacity]: 90,
			[H.zone_type]: labelOf(ZONE_TYPE_CHOICES, 'general'),
			[H.zone_status]: labelOf(ZONE_STATUS_CHOICES, 'active'),
			[H.zone_area_m2]: 700,
			[H.zone_specifics]: 'อาคารเรียน 2 ชั้น จัดเป็นพื้นที่พักครอบครัวทั่วไป'
		},
		{
			[H.zone_code]: 'B',
			[H.zone_name]: 'โซน B - ผู้สูงอายุและกลุ่มเปราะบาง',
			[H.zone_capacity]: 60,
			[H.zone_type]: labelOf(ZONE_TYPE_CHOICES, 'vulnerable'),
			[H.zone_status]: labelOf(ZONE_STATUS_CHOICES, 'active'),
			[H.zone_area_m2]: 500,
			[H.zone_specifics]: 'ใกล้ทางเข้า มีทางลาดสำหรับรถเข็น'
		}
	];

	return { shelter, zones };
}
