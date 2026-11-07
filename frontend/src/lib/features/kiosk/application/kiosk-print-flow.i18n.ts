/** On-screen print failures. The printed label itself stays Thai and is not part of this. */
const th = {
	connection: 'เชื่อมต่อเครื่องพิมพ์ไม่ได้ กรุณาลองอีกครั้ง',
	sendFailed: 'ส่งงานพิมพ์ไม่สำเร็จ กรุณาลองอีกครั้ง',
	renderFailed: 'สร้าง label สำหรับพิมพ์ไม่สำเร็จ กรุณาลองอีกครั้ง',
	printedSoFar: (message: string, printed: number) => `${message} (พิมพ์ออกแล้ว ${printed} ดวง)`
};

const en: typeof th = {
	connection: 'Could not reach the printer. Please try again.',
	sendFailed: 'Could not send the print job. Please try again.',
	renderFailed: 'Could not create the label to print. Please try again.',
	printedSoFar: (message: string, printed: number) => `${message} (${printed} printed)`
};

export const KIOSK_PRINT_FLOW_I18N = { th, en };
