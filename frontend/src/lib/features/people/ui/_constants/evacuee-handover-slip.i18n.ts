export const EVACUEE_HANDOVER_SLIP_I18N = {
	th: {
		title: 'ใบส่งตัวผู้ประสบภัย (Handover Slip)',
		subtitle: 'ส่งต่อโต๊ะคัดกรองการแพทย์ (Station 2)',
		name: 'ชื่อ-นามสกุล',
		nickname: 'ชื่อเล่น',
		idNumber: 'เลขประจำตัวประชาชน / บัตรยืนยันตัวตน',
		phone: 'เบอร์โทรศัพท์',
		noPhone: 'ไม่มีเบอร์โทรศัพท์',
		specialNeeds: 'กลุ่มเปราะบางและความต้องการพิเศษ',
		noSpecialNeeds: 'ไม่มี',
		ewarSymptoms: 'อาการเฝ้าระวังที่พบเบื้องต้น (EWAR)',
		noSymptoms: 'ไม่มีอาการป่วย',
		status: 'สถานะ',
		statusArriving: 'รอตรวจคัดกรอง (Arriving)',
		scanInstruction: 'เจ้าหน้าที่แพทย์สแกน QR Code นี้เพื่อเปิดหน้าคัดกรองการแพทย์ทันที',
		deepLink: 'ลิงก์ระบบคัดกรอง',
		print: 'พิมพ์ใบนำทาง',
		doneNext: 'เสร็จสิ้น / ลงทะเบียนคนถัดไป',
		close: 'ปิด',
		pdfFailedToast: 'ไม่สามารถสร้างไฟล์ PDF ได้',
		pdfBlockedToast: 'เบราว์เซอร์บล็อกการเปิดหน้าต่างพิมพ์ กรุณาอนุญาตป๊อปอัป'
	},
	en: {
		title: 'Evacuee Handover Slip',
		subtitle: 'Station 1 Handover to Station 2 Medical Screening',
		name: 'Full Name',
		nickname: 'Nickname',
		idNumber: 'Citizen ID / Person ID',
		phone: 'Phone Number',
		noPhone: 'No phone number',
		specialNeeds: 'Special Needs & Vulnerable Groups',
		noSpecialNeeds: 'None',
		ewarSymptoms: 'Flagged EWAR Symptoms',
		noSymptoms: 'No symptoms',
		status: 'Status',
		statusArriving: 'Waiting for Screening (Arriving)',
		scanInstruction: 'Medical staff: scan this QR code to open medical screening immediately',
		deepLink: 'Screening Link',
		print: 'Print Slip',
		doneNext: 'Done / Next Registration',
		close: 'Close',
		pdfFailedToast: 'Failed to generate PDF',
		pdfBlockedToast: 'Print popup blocked by browser. Please allow popups.'
	}
} as const;

export type EvacueeHandoverSlipI18n = typeof EVACUEE_HANDOVER_SLIP_I18N;
