export const EVACUEE_QR_MODAL_I18N = {
	th: {
		cardTitle: 'บัตรประจำตัวผู้ประสบภัย',
		closeWindow: 'ปิด',
		backOrRegisterNew: 'ย้อนกลับ / ลงทะเบียนคนใหม่',
		generatingPdf: 'กำลังสร้าง PDF...',
		printIdCard: 'พิมพ์บัตรประจำตัว',
		pdfBlockedToast: 'เบราว์เซอร์บล็อกหน้าต่าง PDF กรุณาอนุญาตป๊อปอัปแล้วลองใหม่',
		pdfFailedToast: 'สร้าง PDF ไม่สำเร็จ',
		qrAlt: (name: string) => `QR Code สำหรับ ${name}`,
		labelSize: 'ฉลาก 80 × 60 มม.',
		printHint: 'ตั้งเครื่องพิมพ์เป็นกระดาษขนาดนี้ พิมพ์ขนาดจริง (100%)',
		labelRenderFailed: 'สร้างภาพฉลากไม่สำเร็จ ลองเปิดหน้าต่างนี้ใหม่',
		previewNote: 'QR ใบปัจจุบันที่ใช้ได้ — กดพิมพ์จะออก QR ใหม่ และใบนี้จะใช้ไม่ได้',
		loadingQr: 'กำลังโหลด QR...',
		currentQrLoadFailed: 'โหลด QR ปัจจุบันไม่สำเร็จ — ยังกดพิมพ์เพื่อออก QR ใหม่ได้',
		printedNote: 'QR ล่าสุดที่ออกให้ — QR ใบก่อนหน้าใช้ไม่ได้แล้ว',
		issueFailedToast: 'ออก QR ใหม่ไม่สำเร็จ จึงยังไม่พิมพ์ กรุณาลองใหม่',
		issuePartialToast: (failed: number) =>
			`ออก QR ไม่สำเร็จ ${failed} คน (ไม่พิมพ์ของคนเหล่านี้) กรุณากดพิมพ์ใหม่`
	},
	en: {
		cardTitle: 'Evacuee Identity Card',
		closeWindow: 'Close',
		backOrRegisterNew: 'Back / Register New Evacuee',
		generatingPdf: 'Generating PDF...',
		printIdCard: 'Print ID Card',
		pdfBlockedToast: 'Browser blocked the PDF window. Please allow popups and try again.',
		pdfFailedToast: 'Failed to generate PDF',
		qrAlt: (name: string) => `QR Code for ${name}`,
		labelSize: 'Label 80 × 60 mm',
		printHint: 'Set the printer to this paper size, actual size (100%)',
		labelRenderFailed: 'Could not render the label. Reopen this window to retry.',
		previewNote: 'Current valid QR — printing issues a new QR and this one stops working',
		loadingQr: 'Loading QR...',
		currentQrLoadFailed: 'Could not load the current QR — you can still print to issue a new one',
		printedNote: 'Latest issued QR — any previous QR no longer works',
		issueFailedToast: 'Could not issue a new QR, so nothing was printed. Please try again.',
		issuePartialToast: (failed: number) =>
			`Could not issue a QR for ${failed} person(s); they were not printed. Press print again.`
	}
} as const;

export type EvacueeQrModalI18n = typeof EVACUEE_QR_MODAL_I18N;
