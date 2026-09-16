/**
 * Canonical master_data definitions for platform init (prod + staging).
 *
 * municipality_zone + community use real Hat Yai municipality lists
 * (เทศบาลนครหาดใหญ่ — 4 เขต / 36 ชุมชน จากประกาศเลือกตั้งคณะกรรมการชุมชน).
 */
import { CR112_VULNERABLE_GROUP_ACTIVE } from '$lib/features/master-data/domain';
import type { MasterTypeDef } from './types';

/** Real Hat Yai communities keyed by zone (parent_key = zone_1…zone_4). */
const HAT_YAI_COMMUNITIES: {
	key: string;
	label: string;
	parent_key: string;
	is_default?: boolean;
}[] = [
	// เขต 1
	{
		key: 'na_khai_senanarong',
		label: 'ชุมชนหน้าค่ายเสนาณรงค์',
		parent_key: 'zone_1',
		is_default: true
	},
	{ key: 'na_suan_satharana', label: 'ชุมชนหน้าสวนสาธารณะ', parent_key: 'zone_1' },
	{ key: 'rong_pun', label: 'ชุมชนโรงปูน', parent_key: 'zone_1' },
	{ key: 'na_rph_sikarin', label: 'ชุมชนหน้าโรงพยาบาลศิครินทร์', parent_key: 'zone_1' },
	{ key: 'ko_suea', label: 'ชุมชนเกาะเสือ', parent_key: 'zone_1' },
	{ key: 'rongrian_chatri', label: 'ชุมชนโรงเรียนชาตรี', parent_key: 'zone_1' },
	{ key: 'sikarin', label: 'ชุมชนศิครินทร์', parent_key: 'zone_1' },
	{ key: 'rathakan', label: 'ชุมชนรัถการ', parent_key: 'zone_1' },
	{ key: 'mae_litao', label: 'ชุมชนแม่ลิเตา', parent_key: 'zone_1' },
	// เขต 2
	{ key: 'talat_mai', label: 'ชุมชนตลาดใหม่', parent_key: 'zone_2' },
	{ key: 'suan_siri', label: 'ชุมชนสวนศิริ', parent_key: 'zone_2' },
	{ key: 'sam_chai', label: 'ชุมชนสามชัย', parent_key: 'zone_2' },
	{ key: 'rph_bangkok', label: 'ชุมชนโรงพยาบาลกรุงเทพ', parent_key: 'zone_2' },
	{ key: 'ban_ja', label: 'ชุมชนบ้านจ่า', parent_key: 'zone_2' },
	{ key: 'klang_na', label: 'ชุมชนกลางนา', parent_key: 'zone_2' },
	{ key: 'sam_yaek_khlong_rian', label: 'ชุมชนสามแยกคลองเรียน', parent_key: 'zone_2' },
	// เขต 3
	{ key: 'chan_prathip', label: 'ชุมชนจันทร์ประทีป', parent_key: 'zone_3' },
	{ key: 'd_land_thai_charoen', label: 'ชุมชนดีแลนด์-ไทยเจริญ', parent_key: 'zone_3' },
	{ key: 'rim_khuan', label: 'ชุมชนริมควน', parent_key: 'zone_3' },
	{ key: 'khlong_rabai_1', label: 'ชุมชนคลองระบายน้ำที่ 1', parent_key: 'zone_3' },
	{ key: 'lang_thiwa_amphoe', label: 'ชุมชนหลังที่ว่าการอำเภอ', parent_key: 'zone_3' },
	{ key: 'plak_krim', label: 'ชุมชนปลักกริม', parent_key: 'zone_3' },
	{ key: 'rattana_wibun', label: 'ชุมชนรัตนวิบูลย์', parent_key: 'zone_3' },
	{ key: 'thung_sao', label: 'ชุมชนทุ่งเสา', parent_key: 'zone_3' },
	{ key: 'khonsong', label: 'ชุมชนขนส่ง', parent_key: 'zone_3' },
	{ key: 'lang_rongphak', label: 'ชุมชนหลังโรงพัก', parent_key: 'zone_3' },
	{ key: 'lang_u_rotfai', label: 'ชุมชนหลังอู่รถไฟ', parent_key: 'zone_3' },
	// เขต 4
	{ key: 'ko_liap', label: 'ชุมชนเกาะเลียบ', parent_key: 'zone_4' },
	{ key: 'wat_hatyai_nai', label: 'ชุมชนวัดหาดใหญ่ใน', parent_key: 'zone_4' },
	{ key: 'rattana_uthit', label: 'ชุมชนรัตนอุทิศ', parent_key: 'zone_4' },
	{ key: 'tha_sai', label: 'ชุมชนท่าไทร', parent_key: 'zone_4' },
	{ key: 'ratchamangkhalaphisek', label: 'ชุมชนรัชมังคลาภิเษก', parent_key: 'zone_4' },
	{ key: 'mongkhon_hansa', label: 'ชุมชนมงคลหรรษา', parent_key: 'zone_4' },
	{ key: 'chok_saman', label: 'ชุมชนโชคสมาน', parent_key: 'zone_4' },
	{ key: 'rat_uthit', label: 'ชุมชนราษฎร์อุทิศ', parent_key: 'zone_4' },
	{ key: 'hua_phan_rotfai', label: 'ชุมชนหัวพานรถไฟ', parent_key: 'zone_4' }
];

export const MASTER_DATA_DEFS: MasterTypeDef[] = [
	{
		type: 'vulnerable_group',
		items: CR112_VULNERABLE_GROUP_ACTIVE.map((item) => ({
			key: item.code,
			label: item.label,
			...('is_default' in item && item.is_default ? { is_default: true as const } : {})
		}))
	},
	{
		type: 'health_condition',
		items: [
			{ key: 'diabetes', label: 'เบาหวาน', is_default: true },
			{ key: 'hypertension', label: 'ความดันโลหิตสูง' },
			{ key: 'heart_disease', label: 'โรคหัวใจ' },
			{ key: 'asthma', label: 'หอบหืด' },
			{ key: 'seafood_allergy', label: 'แพ้อาหารทะเล' },
			{ key: 'sulfa_allergy', label: 'แพ้ยาซัลฟา' }
		]
	},
	{
		type: 'dietary_restrictions',
		items: [
			{ key: 'halal', label: 'อิสลาม (ฮาลาล)', is_default: true },
			{ key: 'vegetarian', label: 'มังสวิรัติ' },
			{ key: 'soft_diet', label: 'อาหารอ่อน' }
		]
	},
	{
		type: 'pet_types',
		items: [
			{ key: 'dog', label: 'สุนัข', is_default: true },
			{ key: 'cat', label: 'แมว' },
			{ key: 'other', label: 'อื่นๆ' }
		]
	},
	{
		type: 'housing_type',
		items: [
			{ key: 'owned_house', label: 'บ้านตนเอง', is_default: true },
			{ key: 'rented_house', label: 'บ้านเช่า' },
			{ key: 'condo', label: 'คอนโดมิเนียม' },
			{ key: 'apartment_dorm', label: 'อพาร์ตเมนต์/หอพัก' },
			{ key: 'homeless', label: 'ไร้ที่อยู่อาศัย / ไม่มีบ้านเลขที่' }
		]
	},
	{
		type: 'house_damage',
		items: [
			{ key: 'total_loss', label: 'เสียหายทั้งหลัง', is_default: true },
			{ key: 'partial', label: 'เสียหายบางส่วน' },
			{ key: 'flooded_first_floor', label: 'น้ำท่วมถึงชั้น 1' }
		]
	},
	{
		type: 'shelter_type',
		items: [
			{ key: 'school', label: 'โรงเรียน', is_default: true },
			{ key: 'community_hall', label: 'ศาลาประชาคม' },
			{ key: 'temple', label: 'วัด' },
			{ key: 'government_building', label: 'อาคารราชการ' },
			{ key: 'sports_centre', label: 'ศูนย์กีฬา' }
		]
	},
	{
		type: 'municipality_zone',
		items: [
			{ key: 'zone_1', label: 'เขตเทศบาลนครหาดใหญ่ 1', is_default: true },
			{ key: 'zone_2', label: 'เขตเทศบาลนครหาดใหญ่ 2' },
			{ key: 'zone_3', label: 'เขตเทศบาลนครหาดใหญ่ 3' },
			{ key: 'zone_4', label: 'เขตเทศบาลนครหาดใหญ่ 4' }
		]
	},
	{
		type: 'community',
		parent_type: 'municipality_zone',
		items: HAT_YAI_COMMUNITIES
	}
];

/** Flat list of community seed keys for volume generators. */
export const COMMUNITY_KEYS = HAT_YAI_COMMUNITIES.map((c) => c.key);

export const HOUSING_TYPE_KEYS = [
	'owned_house',
	'rented_house',
	'condo',
	'apartment_dorm',
	'homeless'
] as const;
