import type { LanguageCode } from '$lib/stores/language.svelte';

/** Copy for the volunteer's own profile editor (skills only; identity is shown read-only). */
export interface ProfileEditTranslations {
	title: string;
	occupationLabel: string;
	noProfile: string;
	noVolunteerCode: string;
	verified: string;
	shelters: (codes: string) => string;
	readOnlyNote: string;
	skillsTitle: string;
	selectedCount: (count: number) => string;
	controlledTitle: string;
	controlledTag: string;
	selfReportedNote: string;
	cancel: string;
	save: string;
	saved: string;
	saveFailed: string;
}

export const profileEditI18n: Record<LanguageCode, ProfileEditTranslations> = {
	th: {
		title: 'แก้ไขโปรไฟล์จิตอาสา',
		occupationLabel: 'อาชีพ',
		noProfile:
			'ยังไม่พบโปรไฟล์ของคุณในระบบ — ลองจองงานอาสาสมัครสักงานก่อน แล้วกลับมาแก้ไขได้ที่นี่',
		noVolunteerCode: 'ยังไม่มีรหัสอาสา',
		verified: 'ยืนยันตัวตนแล้ว',
		shelters: (codes) => `ศูนย์ที่มีโปรไฟล์: ${codes}`,
		readOnlyNote:
			'ชื่อ เบอร์โทร และการยืนยันตัวตน แก้ไขได้ที่เจ้าหน้าที่ศูนย์เท่านั้น — เบอร์โทรเป็นรหัสที่ใช้เข้าระบบนี้',
		skillsTitle: 'ทักษะของฉัน',
		selectedCount: (count) => `เลือกแล้ว ${count} ทักษะ`,
		controlledTitle: 'ทักษะควบคุม — เจ้าหน้าที่ต้องตรวจคุณสมบัติก่อนรับงานที่ใช้ทักษะนี้',
		controlledTag: '(ควบคุม)',
		selfReportedNote:
			'ทักษะที่เลือกเป็นข้อมูลที่ท่านแจ้งเอง ใช้ประกอบการพิจารณาของเจ้าหน้าที่ — งานอาสาสมัครที่ต้องใช้ทักษะควบคุม (เช่น การแพทย์) ยังต้องผ่านการตรวจคุณสมบัติเหมือนเดิม',
		cancel: 'ยกเลิก',
		save: 'บันทึกการเปลี่ยนแปลง',
		saved: 'บันทึกโปรไฟล์แล้ว',
		saveFailed: 'บันทึกโปรไฟล์ไม่สำเร็จ'
	},
	en: {
		title: 'Edit volunteer profile',
		occupationLabel: 'Occupation',
		noProfile:
			'We could not find your profile yet — book a volunteer job first, then come back here to edit it',
		noVolunteerCode: 'No volunteer code yet',
		verified: 'Verified',
		shelters: (codes) => `Shelters with a profile: ${codes}`,
		readOnlyNote:
			'Name, phone number and verification can only be changed by shelter staff — your phone number is the code you use to sign in here',
		skillsTitle: 'My skills',
		selectedCount: (count) => `${count} ${count === 1 ? 'skill' : 'skills'} selected`,
		controlledTitle:
			'Controlled skill — staff must check your qualifications before you take jobs that need it',
		controlledTag: '(controlled)',
		selfReportedNote:
			'The skills you select are self-reported and help staff decide. Volunteer jobs that need a controlled skill (for example medical work) still need a qualification check as before',
		cancel: 'Cancel',
		save: 'Save changes',
		saved: 'Profile saved',
		saveFailed: 'Could not save your profile'
	}
};
