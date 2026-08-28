/**
 * Volunteer skill master list (CR-094 FR-VOL-10.3 / the "VOLUNTEER SKILL MASTER
 * LIST" block of the job form).
 *
 * Pure data — no I/O, no Svelte. This is the ONE place that decides which
 * skills exist and which of them are `controlled` (require a certificate to be
 * verified before the volunteer may be activated); `skills.ts` derives its
 * controlled set from here so the two can never drift apart.
 *
 * FR-VOL-08.5 moves this to editable master data on the settings screen in a
 * later step — until then this constant is the source of truth.
 *
 * `job-form-dialog.svelte` and the walk-in registration screen both iterate
 * this single list unfiltered (owner decision 2026-08-29: the job form's
 * skill list grows to match the walk-in set).
 */

export interface SkillMasterEntry {
	/** Stored value in `job.skills_required[]` / `volunteer.skills[]`. */
	key: string;
	label: string;
	description: string;
	/** Emoji shown on the selectable card. */
	icon: string;
	/** Requires certificate review — forces `pending_review` (CR-094 FR-VOL-10.3). */
	controlled: boolean;
}

export const SKILL_MASTER: readonly SkillMasterEntry[] = [
	{
		key: 'ประกอบอาหาร / ครัวสนาม',
		label: 'ประกอบอาหาร / ครัวสนาม',
		description: 'ช่วยเตรียมวัตถุดิบ ปรุงอาหาร แจกอาหารครัวกลาง',
		icon: '🍳',
		controlled: false
	},
	{
		key: 'ขนย้ายสิ่งของ / พลาธิการ',
		label: 'ขนย้ายสิ่งของ / พลาธิการ',
		description: 'ขนย้ายกระสอบทราย ลำเลียงถุงยังชีพ ยกของหนัก',
		icon: '💪',
		controlled: false
	},
	{
		key: 'คัดกรองและสแกนประวัติ',
		label: 'คัดกรองและสแกนประวัติ',
		description: 'ต้อนรับ ลงทะเบียน คัดกรองประวัติผู้ประสบภัยเบื้องต้น',
		icon: '📝',
		controlled: false
	},
	{
		key: 'การแพทย์ / ปฐมพยาบาล',
		label: 'การแพทย์ / ปฐมพยาบาล',
		description: 'ปฐมพยาบาลเบื้องต้น วัดสัญญาณชีพ (ต้องผ่านการตรวจรับรองใบประกอบวิชาชีพ)',
		icon: '🩺',
		controlled: true
	},
	{
		key: 'ประสานงาน / ต้อนรับ',
		label: 'ประสานงาน / ต้อนรับ',
		description: 'ต้อนรับผู้ประสบภัย ประสานงานระหว่างจุดบริการ',
		icon: '🤝',
		controlled: false
	},
	{
		key: 'แจกจ่ายของยังชีพ',
		label: 'แจกจ่ายของยังชีพ',
		description: 'แจกจ่ายถุงยังชีพ น้ำดื่ม เครื่องอุปโภคบริโภค',
		icon: '🎒',
		controlled: false
	},
	{
		key: 'ทำความสะอาด / สุขอนามัย',
		label: 'ทำความสะอาด / สุขอนามัย',
		description: 'ทำความสะอาดพื้นที่ส่วนกลาง ดูแลสุขอนามัยในศูนย์',
		icon: '🧹',
		controlled: false
	},
	{
		key: 'สันทนาการ / ดูแลเด็ก',
		label: 'สันทนาการ / ดูแลเด็ก',
		description: 'กิจกรรมสันทนาการ ดูแลเด็กและผู้สูงอายุ',
		icon: '🎈',
		controlled: false
	},
	{
		key: 'ขับขี่ยานพาหนะ / ขนส่ง',
		label: 'ขับขี่ยานพาหนะ / ขนส่ง',
		description: 'ขับขี่ยานพาหนะขนส่งคนและสิ่งของ',
		icon: '🚗',
		controlled: false
	}
];

/** Master-list keys that require certificate review before activation. */
export const CONTROLLED_SKILL_KEYS: readonly string[] = SKILL_MASTER.filter(
	(s) => s.controlled
).map((s) => s.key);

export function findSkill(key: string): SkillMasterEntry | undefined {
	return SKILL_MASTER.find((s) => s.key === key);
}
