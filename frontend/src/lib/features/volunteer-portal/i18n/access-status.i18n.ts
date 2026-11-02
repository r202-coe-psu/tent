import type { LanguageCode } from '$lib/stores/language.svelte';

export interface AccessStatusTranslations {
	title: string;
	loading: string;
	loadError: string;
	none: string;
	/** Role with the date its grant ends, e.g. `ผู้ประสานงาน · หมดอายุสิ้นวันที่ 30/10/2569`. */
	activeUntil: (role: string, date: string) => string;
	/** A permanent role: no date to show. */
	activePermanent: (role: string) => string;
	disabled: string;
	loginButton: string;
}

export const accessStatusI18n: Record<LanguageCode, AccessStatusTranslations> = {
	th: {
		title: 'สิทธิ์ใช้งานระบบ',
		loading: 'กำลังตรวจสอบสิทธิ์...',
		loadError: 'ไม่สามารถตรวจสอบสิทธิ์ใช้งานระบบได้',
		none: 'ยังไม่ได้รับสิทธิ์ใช้งานระบบ — ติดต่อผู้ประสานงานจิตอาสาของศูนย์',
		activeUntil: (role, date) => `${role} · หมดอายุสิ้นวันที่ ${date}`,
		activePermanent: (role) => role,
		disabled: 'บัญชีถูกระงับ — ติดต่อผู้ดูแลระบบ',
		loginButton: 'เข้าสู่ระบบเจ้าหน้าที่'
	},
	en: {
		title: 'System access',
		loading: 'Checking access...',
		loadError: 'Could not check your system access',
		none: 'No system access yet — contact the shelter volunteer coordinator',
		activeUntil: (role, date) => `${role} · expires at the end of ${date}`,
		activePermanent: (role) => role,
		disabled: 'Account suspended — contact the system administrator',
		loginButton: 'Sign in as staff'
	}
};
