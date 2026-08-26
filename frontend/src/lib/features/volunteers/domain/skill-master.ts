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
 * Scope (owner decision 2026-08-27): the job form lists these four only. The
 * walk-in mockup shows a wider set (ประสานงาน/ต้อนรับ, แจกจ่ายของยังชีพ,
 * ทำความสะอาด/สุขอนามัย, สันทนาการ/ดูแลเด็ก, ขับขี่ยานพาหนะ/ขนส่ง) — add them
 * here when that screen is built, so both screens keep reading one list.
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
	}
];

/** Master-list keys that require certificate review before activation. */
export const CONTROLLED_SKILL_KEYS: readonly string[] = SKILL_MASTER.filter(
	(s) => s.controlled
).map((s) => s.key);

export function findSkill(key: string): SkillMasterEntry | undefined {
	return SKILL_MASTER.find((s) => s.key === key);
}
