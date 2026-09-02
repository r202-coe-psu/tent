export const EVACUEE_EWAR_I18N = {
	th: {
		isolationTitle: 'ระวัง! ต้องส่งไปยังโซนกักกันโรคด่วน',
		isolationBadge: '(ISOLATION NEEDED)',
		isolationDesc:
			'พบอาการกลุ่มเสี่ยงโรคระบาด ให้ดำเนินการย้ายไปยังโซนกักกันโรคทันที และทำรายการต่อ',
		healthyLabel: 'ไม่มีอาการป่วย (Healthy / No Symptoms)',
		next: 'ถัดไป →',
		back: 'ย้อนกลับ',
		toastSelectRequired: 'กรุณาเลือกอาการที่พบ หรือระบุว่า "ไม่มีอาการ" ก่อนดำเนินการต่อ',
		toastMedicalRequired:
			'กรุณาระบุข้อมูลสุขภาพแต่ละช่อง หรือกดปุ่ม "ไม่มี" ในแต่ละช่องก่อนดำเนินการต่อ',
		toastSpecialRequired:
			'กรุณาเลือกกลุ่มเปราะบาง หรือกดปุ่ม "ไม่เป็นกลุ่มเปราะบาง" ก่อนดำเนินการต่อ'
	},
	en: {
		isolationTitle: 'Warning! Immediate Isolation Required',
		isolationBadge: '(ISOLATION NEEDED)',
		isolationDesc:
			'Suspected epidemic symptoms detected. Move to isolation zone immediately and continue.',
		healthyLabel: 'Healthy / No Symptoms',
		next: 'Next →',
		back: 'Back',
		toastSelectRequired: 'Please select symptoms or check "Healthy / No Symptoms" before proceeding',
		toastMedicalRequired:
			'Please complete each health field or tap "None" on each field before proceeding',
		toastSpecialRequired:
			'Please select vulnerable-group tags or tap "Not a vulnerable group" before proceeding'
	}
} as const;

export type EvacueeEwarI18n = typeof EVACUEE_EWAR_I18N;
