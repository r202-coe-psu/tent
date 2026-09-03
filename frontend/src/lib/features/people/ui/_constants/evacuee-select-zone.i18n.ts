export const EVACUEE_SELECT_ZONE_I18N = {
	th: {
		errorTitle: 'โหลดข้อมูลโซนไม่สำเร็จ',
		errorDesc: 'ยังเลือกพื้นที่พักพิงไม่ได้ กรุณาลองโหลดรายการโซนอีกครั้ง',
		retry: 'ลองใหม่',
		recommendedHeader: 'โซนแนะนำสำหรับผู้พักพิงรายนี้',
		loading: 'กำลังโหลดข้อมูลโซน...',
		recommendedNote: (typeStr: string) => `แนะนำตามสถานะ (${typeStr})`,
		typeVulnerable: 'กลุ่มเปราะบาง',
		typeGeneral: 'บุคคลทั่วไป',
		noZones: 'ไม่มีโซนที่เปิดให้บริการในศูนย์นี้',
		btnConfirm: 'ยืนยันโซนนี้',
		btnConfirmRecommended: 'ยืนยันโซนแนะนำ',
		btnSaving: 'กำลังบันทึกโซน...',
		btnOtherZones: 'เลือกโซนอื่น',
		btnHideOtherZones: 'ใช้โซนแนะนำ',
		otherZonesTitle: 'เลือกโซนอื่น',
		back: 'ย้อนกลับ'
	},
	en: {
		errorTitle: 'Failed to load zones',
		errorDesc: 'Cannot select shelter zone right now. Please reload zone list.',
		retry: 'Retry',
		recommendedHeader: 'Recommended zone for this evacuee',
		loading: 'Loading zone data...',
		recommendedNote: (typeStr: string) => `Recommended based on status (${typeStr})`,
		typeVulnerable: 'Vulnerable group',
		typeGeneral: 'General',
		noZones: 'No active zones available in this shelter',
		btnConfirm: 'Confirm this zone',
		btnConfirmRecommended: 'Confirm recommended zone',
		btnSaving: 'Saving zone allocation...',
		btnOtherZones: 'Choose another zone',
		btnHideOtherZones: 'Use recommended zone',
		otherZonesTitle: 'Select another zone',
		back: 'Back'
	}
} as const;

export type EvacueeSelectZoneI18n = typeof EVACUEE_SELECT_ZONE_I18N;
