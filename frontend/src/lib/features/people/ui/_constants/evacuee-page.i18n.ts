export const EVACUEE_PAGE_I18N = {
	th: {
		pageTitle: 'ลงทะเบียนผู้ประสบภัย | SmartShelter Thailand',
		back: 'กลับ',
		title: 'ลงทะเบียนผู้ประสบภัย',
		fastTrackTitle: 'การลงทะเบียนช่องทางพิเศษ (Fast Track)',
		fastTrackDesc: 'สำหรับกลุ่มเปราะบาง มีความต้องการพิเศษ หรือกรณีฉุกเฉินทางการแพทย์',
		saveErrorSummary: 'บันทึกไม่สำเร็จ — ระบบปฏิเสธเอกสาร',
		toastSaveFailed: 'บันทึกไม่สำเร็จ — ดูรายละเอียดในกล่องแจ้งเตือนด้านบน'
	},
	en: {
		pageTitle: 'Evacuee Registration | SmartShelter Thailand',
		back: 'Back',
		title: 'Evacuee Registration',
		fastTrackTitle: 'Fast Track Registration',
		fastTrackDesc: 'For vulnerable groups, special needs, or medical emergencies',
		saveErrorSummary: 'Save failed — Document rejected by system',
		toastSaveFailed: 'Save failed — see details in the alert box above'
	}
} as const;

export type EvacueePageI18n = typeof EVACUEE_PAGE_I18N;
