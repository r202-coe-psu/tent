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
