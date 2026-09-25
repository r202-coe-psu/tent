/**
 * Canonical master_data definitions for platform init (prod + staging).
 *
 * CR-137: only vulnerable_group, housing_type, shelter_type, volunteer_skills.
 * municipality_zone / community are free-text fields on household/shelter docs
 * (not master types). Pet species is a domain enum (dog|cat|other).
 *
 * Every item uses `key` as the persisted `code` (semantic snake_case) and
 * bilingual `label_th` / `label_en`.
 */
import { CR112_VULNERABLE_GROUP_ACTIVE } from '$lib/features/master-data/domain';
import type { MasterTypeDef } from './types';

export const MASTER_DATA_DEFS: MasterTypeDef[] = [
	{
		type: 'vulnerable_group',
		items: CR112_VULNERABLE_GROUP_ACTIVE.map((item) => ({
			key: item.code,
			label_th: item.label_th,
			label_en: item.label_en,
			...('is_default' in item && item.is_default ? { is_default: true as const } : {})
		}))
	},
	{
		type: 'housing_type',
		items: [
			{
				key: 'owned_house',
				label_th: 'บ้านตนเอง',
				label_en: 'Owned house',
				is_default: true
			},
			{ key: 'rented_house', label_th: 'บ้านเช่า', label_en: 'Rented house' },
			{ key: 'condo', label_th: 'คอนโดมิเนียม', label_en: 'Condominium' },
			{
				key: 'apartment_dorm',
				label_th: 'อพาร์ตเมนต์/หอพัก',
				label_en: 'Apartment / dormitory'
			},
			{
				key: 'homeless',
				label_th: 'ไร้ที่อยู่อาศัย / ไม่มีบ้านเลขที่',
				label_en: 'Homeless / no house number'
			}
		]
	},
	{
		type: 'shelter_type',
		items: [
			{ key: 'school', label_th: 'โรงเรียน', label_en: 'School', is_default: true },
			{ key: 'community_hall', label_th: 'ศาลาประชาคม', label_en: 'Community hall' },
			{ key: 'temple', label_th: 'วัด', label_en: 'Temple' },
			{
				key: 'government_building',
				label_th: 'อาคารราชการ',
				label_en: 'Government building'
			},
			{ key: 'sports_centre', label_th: 'ศูนย์กีฬา', label_en: 'Sports centre' }
		]
	},
	{
		type: 'volunteer_skills',
		items: [
			{
				key: 'cooking',
				label_th: 'ประกอบอาหาร / ครัวสนาม',
				label_en: 'Cooking / field kitchen',
				category: 'operational',
				description: 'ช่วยเตรียมวัตถุดิบ ปรุงอาหาร แจกอาหารครัวกลาง',
				is_default: true
			},
			{
				key: 'logistics',
				label_th: 'ขนย้ายสิ่งของ / พลาธิการ',
				label_en: 'Logistics / supply movement',
				category: 'operational',
				description: 'ขนย้ายกระสอบทราย ลำเลียงถุงยังชีพ ยกของหนัก'
			},
			{
				key: 'screening',
				label_th: 'คัดกรองและสแกนประวัติ',
				label_en: 'Screening and registration',
				category: 'operational',
				description: 'ต้อนรับ ลงทะเบียน คัดกรองประวัติผู้ประสบภัยเบื้องต้น'
			},
			{
				key: 'medical',
				label_th: 'การแพทย์ / ปฐมพยาบาล',
				label_en: 'Medical / first aid',
				category: 'controlled',
				description: 'ปฐมพยาบาลเบื้องต้น วัดสัญญาณชีพ (ต้องผ่านการตรวจรับรองใบประกอบวิชาชีพ)'
			},
			{
				key: 'reception',
				label_th: 'ประสานงาน / ต้อนรับ',
				label_en: 'Coordination / reception',
				category: 'operational',
				description: 'ต้อนรับผู้ประสบภัย ประสานงานระหว่างจุดบริการ'
			},
			{
				key: 'distribution',
				label_th: 'แจกจ่ายของยังชีพ',
				label_en: 'Relief distribution',
				category: 'operational',
				description: 'แจกจ่ายถุงยังชีพ น้ำดื่ม เครื่องอุปโภคบริโภค'
			},
			{
				key: 'sanitation',
				label_th: 'ทำความสะอาด / สุขอนามัย',
				label_en: 'Cleaning / sanitation',
				category: 'operational',
				description: 'ทำความสะอาดพื้นที่ส่วนกลาง ดูแลสุขอนามัยในศูนย์'
			},
			{
				key: 'childcare',
				label_th: 'สันทนาการ / ดูแลเด็ก',
				label_en: 'Recreation / childcare',
				category: 'operational',
				description: 'กิจกรรมสันทนาการ ดูแลเด็กและผู้สูงอายุ'
			},
			{
				key: 'transport',
				label_th: 'ขับขี่ยานพาหนะ / ขนส่ง',
				label_en: 'Driving / transport',
				category: 'operational',
				description: 'ขับขี่ยานพาหนะขนส่งคนและสิ่งของ'
			}
		]
	}
];

/** Sample free-text community names for volume generators (CR-137 — not master codes). */
export const SAMPLE_COMMUNITY_LABELS = [
	'ชุมชนหน้าค่ายเสนาณรงค์',
	'ชุมชนตลาดใหม่',
	'ชุมชนจันทร์ประทีป',
	'ชุมชนเกาะเลียบ',
	'ชุมชนสวนศิริ',
	'ชุมชนริมควน',
	'ชุมชนท่าไทร',
	'ชุมชนสามชัย'
] as const;

/** Sample free-text municipality zone names for volume generators. */
export const SAMPLE_ZONE_LABELS = [
	'เขตเทศบาลนครหาดใหญ่ 1',
	'เขตเทศบาลนครหาดใหญ่ 2',
	'เขตเทศบาลนครหาดใหญ่ 3',
	'เขตเทศบาลนครหาดใหญ่ 4'
] as const;

export const HOUSING_TYPE_KEYS = [
	'owned_house',
	'rented_house',
	'condo',
	'apartment_dorm',
	'homeless'
] as const;
