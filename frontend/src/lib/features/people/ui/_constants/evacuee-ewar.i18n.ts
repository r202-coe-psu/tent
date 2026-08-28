export const EVACUEE_EWAR_I18N = {
	th: {
		isolationTitle: 'ระวัง! ต้องส่งไปยังโซนกักกันโรคด่วน',
		isolationBadge: '(ISOLATION NEEDED)',
		isolationDesc:
			'พบอาการกลุ่มเสี่ยงโรคระบาด ให้ดำเนินการย้ายไปยังโซนกักกันโรคทันที และทำรายการต่อ',
		healthyLabel: 'ไม่มีอาการป่วย (Healthy / No Symptoms)',
		next: 'ถัดไป →',
		back: 'ย้อนกลับ',
		toastSelectRequired: 'กรุณาเลือกอาการที่พบ หรือระบุว่า "ไม่มีอาการ" ก่อนดำเนินการต่อ'
	},
	en: {
		isolationTitle: 'Warning! Immediate Isolation Required',
		isolationBadge: '(ISOLATION NEEDED)',
		isolationDesc:
			'Suspected epidemic symptoms detected. Move to isolation zone immediately and continue.',
		healthyLabel: 'Healthy / No Symptoms',
		next: 'Next →',
		back: 'Back',
		toastSelectRequired: 'Please select symptoms or check "Healthy / No Symptoms" before proceeding'
	}
} as const;

export type EvacueeEwarI18n = typeof EVACUEE_EWAR_I18N;
