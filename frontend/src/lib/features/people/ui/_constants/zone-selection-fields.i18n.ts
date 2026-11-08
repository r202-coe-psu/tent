import { ZONE_TYPE_LABELS, type ZoneType } from '$lib/features/shelters/index.js';

const th = {
	zoneTypes: ZONE_TYPE_LABELS,
	recommendQuarantine: 'แนะนำสำหรับผู้มีอาการเฝ้าระวัง (กักตัว)',
	recommendVulnerable: 'แนะนำสำหรับผู้มีความต้องการพิเศษหรือกลุ่มเปราะบาง',
	recommendGeneral: 'ไม่มีอาการเฝ้าระวังหรือความต้องการพิเศษ — แนะนำโซนทั่วไป',
	preferredUsePrefix: 'โซนที่สถานี 1 ระบุไว้:',
	preferredUseSuffix: '— เลือกไว้ให้แล้ว เปลี่ยนได้',
	quarantineOverridesPrefix: 'สถานี 1 ระบุโซน',
	quarantineOverridesSuffix: 'ไว้ — ไม่ได้เลือกให้ เพราะมีอาการเฝ้าระวัง ต้องแยกไปโซนกักโรค',
	preferredUnavailable: (code: string) =>
		`โซนที่สถานี 1 ระบุไว้ (${code}) ไม่เปิดใช้งานแล้ว — กรุณาเลือกโซนเอง`,
	noOpenZone: (kind: string) => `ไม่มี${kind} ที่เปิดอยู่`,
	pickManually: '— กรุณาเลือกโซนด้วยตนเอง',
	recommendedZone: 'โซนแนะนำ:',
	selectRecommended: 'เลือกโซนแนะนำ',
	selectedBadge: 'เลือกอยู่',
	selectLabel: 'เลือกโซนที่พัก (Active Shelter Zones)',
	noZones: 'ไม่พบรายการโซนในระบบ',
	placeholder: '-- เลือกโซนที่พัก --',
	recommendedItemSuffix: ' ★ แนะนำ',
	allZones: 'รายการโซนทั้งหมด:',
	quarantineBadgePrefix: 'โซน',
	quarantineBadgeSuffix: '',
	recommendedBadge: 'แนะนำ',
	occupancy: (count: number, capacity: number | null | undefined) =>
		`พักอยู่ ${count} ${capacity != null ? `/ ${capacity}` : ''} คน`
};

const en: typeof th = {
	zoneTypes: {
		general: 'General',
		male: 'Men only',
		female: 'Women only',
		vulnerable: 'Vulnerable',
		pet: 'Pets',
		quarantine: 'Quarantine'
	} satisfies Record<ZoneType, string>,
	recommendQuarantine: 'Recommended for people with watch-list symptoms (quarantine)',
	recommendVulnerable: 'Recommended for people with special needs or vulnerable groups',
	recommendGeneral: 'No watch-list symptoms or special needs — general zone recommended',
	preferredUsePrefix: 'Zone given at Station 1:',
	preferredUseSuffix: '— preselected, you can change it',
	quarantineOverridesPrefix: 'Station 1 suggested zone',
	quarantineOverridesSuffix:
		'but it was not preselected because of watch-list symptoms — separate into a quarantine zone',
	preferredUnavailable: (code: string) =>
		`The zone given at Station 1 (${code}) is no longer active — please choose a zone yourself`,
	noOpenZone: (kind: string) => `No open ${kind.toLowerCase()}`,
	pickManually: '— please choose a zone manually',
	recommendedZone: 'Recommended zone:',
	selectRecommended: 'Select recommended zone',
	selectedBadge: 'Selected',
	selectLabel: 'Select shelter zone (Active Shelter Zones)',
	noZones: 'No zones found in the system',
	placeholder: '-- Select a shelter zone --',
	recommendedItemSuffix: ' ★ Recommended',
	allZones: 'All zones:',
	quarantineBadgePrefix: '',
	quarantineBadgeSuffix: ' zone',
	recommendedBadge: 'Recommended',
	occupancy: (count: number, capacity: number | null | undefined) =>
		`${count} ${capacity != null ? `/ ${capacity} ` : ''}staying`
};

export const ZONE_SELECTION_FIELDS_I18N = { th, en };
