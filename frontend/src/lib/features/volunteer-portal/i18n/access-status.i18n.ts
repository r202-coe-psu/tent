import type { LanguageCode } from '$lib/stores/language.svelte';

export interface AccessStatusTranslations {
	title: string;
	loading: string;
	loadError: string;
	none: string;
	/** Had access here, now ended for any reason; `date` is when it ended, or null when unknown. */
	lapsed: (date: string | null) => string;
	/** Role with the date its grant ends, e.g. `ผู้ประสานงาน · หมดอายุสิ้นวันที่ 30/10/2569`. */
	activeUntil: (role: string, date: string) => string;
	/** A permanent role: no date to show. */
	activePermanent: (role: string) => string;
	/** Active but the role has no label (should not happen): say there is access, not that there is none. */
	activeUnlabelled: (date: string | null) => string;
	loginButton: string;
}

export const accessStatusI18n: Record<LanguageCode, AccessStatusTranslations> = {
	th: {
		title: 'สิทธิ์ใช้งานระบบ',
		loading: 'กำลังตรวจสอบสิทธิ์...',
		loadError: 'ไม่สามารถตรวจสอบสิทธิ์ใช้งานระบบได้',
		none: 'ยังไม่ได้รับสิทธิ์ใช้งานระบบ — ติดต่อผู้ประสานงานจิตอาสาของศูนย์',
		lapsed: (date) =>
			date
				? `สิทธิ์ใช้งานระบบสิ้นสุดตั้งแต่วันที่ ${date} — ติดต่อผู้ประสานงานจิตอาสาของศูนย์`
				: 'สิทธิ์ใช้งานระบบสิ้นสุดแล้ว — ติดต่อผู้ประสานงานจิตอาสาของศูนย์',
		activeUntil: (role, date) => `${role} · หมดอายุสิ้นวันที่ ${date}`,
		activePermanent: (role) => role,
		activeUnlabelled: (date) =>
			date ? `มีสิทธิ์ใช้งานระบบ · หมดอายุสิ้นวันที่ ${date}` : 'มีสิทธิ์ใช้งานระบบ',
		loginButton: 'เข้าสู่ระบบเจ้าหน้าที่'
	},
	en: {
		title: 'System access',
		loading: 'Checking access...',
		loadError: 'Could not check your system access',
		none: 'No system access yet — contact the shelter volunteer coordinator',
		lapsed: (date) =>
			date
				? `System access ended on ${date} — contact the shelter volunteer coordinator`
				: 'System access has ended — contact the shelter volunteer coordinator',
		activeUntil: (role, date) => `${role} · expires at the end of ${date}`,
		activePermanent: (role) => role,
		activeUnlabelled: (date) =>
			date ? `You have system access · expires at the end of ${date}` : 'You have system access',
		loginButton: 'Sign in as staff'
	}
};
