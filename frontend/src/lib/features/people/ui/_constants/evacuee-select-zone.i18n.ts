export const EVACUEE_SELECT_ZONE_I18N = {
	th: {
		errorTitle: 'โหลดข้อมูลโซนไม่สำเร็จ',
		errorDesc: 'ยังเลือกพื้นที่พักพิงไม่ได้ กรุณาลองโหลดรายการโซนอีกครั้ง',
		retry: 'ลองใหม่',
		recommendedHeader: 'โซนแนะนำ',
		loading: 'กำลังโหลดข้อมูลโซน...',
		recommendedNote: (typeStr: string) => `แนะนำตามสถานะของผู้อพยพ (${typeStr})`,
		typeVulnerable: 'กลุ่มเปราะบาง',
		typeGeneral: 'บุคคลทั่วไป',
		noZones: 'ไม่มีโซนที่เปิดให้บริการในศูนย์นี้',
		selectPlaceholder: 'เลือกโซน...',
		btnConfirm: 'ยืนยันการเลือกโซน และไปขั้นตอนถัดไป >',
		btnSaving: 'กำลังบันทึกโซน...',
		back: 'ย้อนกลับ'
	},
	en: {
		errorTitle: 'Failed to load zones',
		errorDesc: 'Cannot select shelter zone right now. Please reload zone list.',
		retry: 'Retry',
		recommendedHeader: 'Recommended Zone',
		loading: 'Loading zone data...',
		recommendedNote: (typeStr: string) => `Recommended based on evacuee status (${typeStr})`,
		typeVulnerable: 'Vulnerable Group',
		typeGeneral: 'General',
		noZones: 'No active zones available in this shelter',
		selectPlaceholder: 'Select zone...',
		btnConfirm: 'Confirm Zone Selection & Proceed >',
		btnSaving: 'Saving zone allocation...',
		back: 'Back'
	}
} as const;

export type EvacueeSelectZoneI18n = typeof EVACUEE_SELECT_ZONE_I18N;
