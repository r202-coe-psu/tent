import type { LuggageRule, ParkingRule, PetCategory, PetCondition } from './schema';

/**
 * Single source of truth for CR-023 Addendum A policy label text — shared by the
 * shelter-config forms (admission/luggage/parking policy sections) and by any
 * read-side surface that renders a shelter's configured disclaimer (e.g. the
 * evacuee registration Assets & Pets step).
 */

export const luggageRuleLabels: Record<LuggageRule, string> = {
	valuables_self_responsibility:
		'ทรัพย์สินมีค่า (เช่น เงินสด, ทอง, เครื่องประดับ, สมาร์ทโฟน) ผู้พักพิงต้องเก็บติดตัวและรับผิดชอบด้วยตนเอง 100% ศูนย์ไม่รับผิดชอบกรณีสูญหายทุกกรณี',
	no_hazardous_items:
		'ห้ามนำวัตถุไวไฟ สารเคมีอันตราย ยาเสพติด หรืออาวุธทุกชนิดเข้าศูนย์โดยเด็ดขาด (ตรวจพบแจ้งตำรวจทันที)',
	no_large_appliances:
		'ห้ามนำเครื่องใช้ไฟฟ้าขนาดใหญ่ (เช่น ตู้เย็น, ทีวี, เครื่องซักผ้า) เข้ามาในโซนพักอาศัย',
	has_temp_storage_service:
		'มีบริการ "จุดรับฝากของขนาดใหญ่" ชั่วคราว (พร้อมระบบลงทะเบียนรับ-ส่งคืน)'
};

export const parkingRuleLabels: Record<ParkingRule, string> = {
	no_liability: 'ศูนย์ไม่รับผิดชอบต่อความสูญหายหรือความเสียหายของยานพาหนะในทุกกรณี',
	first_come_first_served:
		'ให้สิทธิ์การจอดแบบ มาก่อนได้ก่อน (First come, First served) จนกว่าพื้นที่จะเต็ม',
	key_deposit_required:
		'เจ้าของรถต้อง ฝากกุญแจรถไว้ที่กองอำนวยการ (เพื่อความรวดเร็วในการเคลื่อนย้ายกรณีฉุกเฉิน)',
	no_blocking_emergency_lane: 'ห้ามจอดกีดขวางเส้นทางเดินรถฉุกเฉิน / รถพยาบาล โดยเด็ดขาด',
	ev_emergency_charging: 'เฉพาะรถยนต์ EV: ศูนย์มีจุดรองรับการชาร์จฉุกเฉิน (จำกัดเวลา)'
};

export const petCategoryLabels: Record<PetCategory, string> = {
	small_general: '🐾 สัตว์เลี้ยงทั่วไป / ขนาดเล็ก (สุนัขพันธุ์เล็ก, แมว, นก, สัตว์น้ำ)',
	large_dog: '🐕 สุนัขขนาดใหญ่ / สัตว์ที่ต้องควบคุมพิเศษ',
	livestock: '🐄 ปศุสัตว์ / สัตว์เพื่อการเกษตร (วัว, ควาย, แพะ, หมู)'
};

export const petConditionLabels: Record<PetCondition, string> = {
	bring_own_cage: 'ผู้พักพิงต้องเตรียมกรง / กระเป๋า / โหล มาเอง (ศูนย์ไม่มีอุปกรณ์รองรับ)',
	caged_or_leashed: 'สัตว์ต้องอยู่ในกรง หรือมีสายจูงตลอดเวลา',
	vaccine_book: 'ต้องแสดงสมุดวัคซีน (เช่น วัคซีนพิษสุนัขบ้า)',
	owner_hygiene: 'เจ้าของต้องเป็นผู้ดูแลเรื่องความสะอาดและมูลสัตว์อย่างเคร่งครัด',
	closed_system_only: 'อนุญาตเฉพาะระบบปิด (ไม่อนุญาตให้ปล่อยเดินอิสระ)',
	muzzle_and_leash: 'ต้องสวมตะกร้อครอบปาก (Muzzle) และมีสายจูงตลอดเวลา',
	designated_zone_only: 'เจ้าของต้องผูก/ควบคุมสัตว์ไว้ในโซนที่กำหนดให้เท่านั้น',
	vaccine_book_mandatory: 'ต้องแสดงสมุดวัคซีน (บังคับ)',
	aggressive_behavior_expel_right: 'หากสัตว์มีพฤติกรรมก้าวร้าว ศูนย์ขอสงวนสิทธิ์ในการเชิญออก',
	owner_provides_feed: 'เจ้าของต้องเตรียมอาหาร/ฟางหญ้ามาเอง (ศูนย์ไม่มีเสบียงสัตว์)',
	tethered_designated_area_only: 'ต้องผูกล่ามในพื้นที่ที่กำหนดเท่านั้น'
};

/** Per-category condition whitelist + ordering — mirrors admission-policy-section.svelte. */
export const petCategoryConditions: Record<PetCategory, PetCondition[]> = {
	small_general: [
		'bring_own_cage',
		'caged_or_leashed',
		'vaccine_book',
		'owner_hygiene',
		'closed_system_only'
	],
	large_dog: [
		'muzzle_and_leash',
		'designated_zone_only',
		'vaccine_book_mandatory',
		'aggressive_behavior_expel_right'
	],
	livestock: ['owner_provides_feed', 'tethered_designated_area_only']
};

export const petCategoryOrder: PetCategory[] = ['small_general', 'large_dog', 'livestock'];

export type PolicyLabelSet = {
	luggage: Record<LuggageRule, string>;
	parking: Record<ParkingRule, string>;
	petCategory: Record<PetCategory, string>;
	petCondition: Record<PetCondition, string>;
};

/**
 * English mirror of the label maps above, for read-side surfaces with a language toggle
 * (public pre-register disclaimer). The Thai maps stay the source of truth — shelter-import
 * matches on them, so never reword Thai here to fit a translation.
 */
const policyLabelsEn: PolicyLabelSet = {
	luggage: {
		valuables_self_responsibility:
			'Valuables (e.g. cash, gold, jewellery, smartphones) must be kept on you and are 100% your own responsibility. The shelter is not liable for any loss.',
		no_hazardous_items:
			'Flammable materials, hazardous chemicals, illegal drugs and weapons of any kind are strictly prohibited (police will be notified if found).',
		no_large_appliances:
			'Large electrical appliances (e.g. refrigerators, TVs, washing machines) are not allowed in the living area.',
		has_temp_storage_service:
			'A temporary large-item storage point is available (with check-in / check-out registration).'
	},
	parking: {
		no_liability: 'The shelter is not liable for loss of or damage to vehicles in any case.',
		first_come_first_served: 'Parking is first come, first served until spaces are full.',
		key_deposit_required:
			'Vehicle owners must leave their keys at the command centre (so vehicles can be moved quickly in an emergency).',
		no_blocking_emergency_lane: 'Never park blocking emergency vehicle or ambulance routes.',
		ev_emergency_charging:
			'EVs only: emergency charging is available at the shelter (time-limited).'
	},
	petCategory: {
		small_general: '🐾 General / small pets (small dogs, cats, birds, fish)',
		large_dog: '🐕 Large dogs / animals needing special control',
		livestock: '🐄 Livestock / farm animals (cattle, buffalo, goats, pigs)'
	},
	petCondition: {
		bring_own_cage: 'Bring your own cage / carrier / tank (the shelter has no equipment for pets).',
		caged_or_leashed: 'Animals must be caged or leashed at all times.',
		vaccine_book: 'Show a vaccination record (e.g. rabies vaccine).',
		owner_hygiene: 'Owners must strictly take care of cleanliness and animal waste.',
		closed_system_only: 'Enclosed only (animals may not roam freely).',
		muzzle_and_leash: 'Must wear a muzzle and be leashed at all times.',
		designated_zone_only: 'Owners must tie up / control animals in the designated zone only.',
		vaccine_book_mandatory: 'A vaccination record must be shown (mandatory).',
		aggressive_behavior_expel_right:
			'If an animal behaves aggressively, the shelter reserves the right to ask it to leave.',
		owner_provides_feed:
			'Owners must bring their own feed / hay (the shelter has no animal supplies).',
		tethered_designated_area_only: 'Must be tethered in the designated area only.'
	}
};

export const policyLabelsByLanguage: { th: PolicyLabelSet; en: PolicyLabelSet } = {
	th: {
		luggage: luggageRuleLabels,
		parking: parkingRuleLabels,
		petCategory: petCategoryLabels,
		petCondition: petConditionLabels
	},
	en: policyLabelsEn
};
