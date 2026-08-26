export const EVACUEE_QR_MODAL_I18N = {
	th: {
		cardTitle: 'บัตรประจำตัวผู้ประสบภัย',
		closeWindow: 'ปิดหน้าต่าง',
		backOrRegisterNew: 'ย้อนกลับ / ลงทะเบียนคนใหม่',
		generatingPdf: 'กำลังสร้าง PDF...',
		printIdCard: 'พิมพ์บัตรประจำตัว',
		pdfBlockedToast: 'เบราว์เซอร์บล็อกหน้าต่าง PDF กรุณาอนุญาตป๊อปอัปแล้วลองใหม่',
		pdfFailedToast: 'สร้าง PDF ไม่สำเร็จ',
		qrAlt: (name: string) => `QR Code สำหรับ ${name}`
	},
	en: {
		cardTitle: 'Evacuee Identity Card',
		closeWindow: 'Close Window',
		backOrRegisterNew: 'Back / Register New Evacuee',
		generatingPdf: 'Generating PDF...',
		printIdCard: 'Print ID Card',
		pdfBlockedToast: 'Browser blocked the PDF window. Please allow popups and try again.',
		pdfFailedToast: 'Failed to generate PDF',
		qrAlt: (name: string) => `QR Code for ${name}`
	}
} as const;

export type EvacueeQrModalI18n = typeof EVACUEE_QR_MODAL_I18N;
