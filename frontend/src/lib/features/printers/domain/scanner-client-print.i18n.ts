import { getTranslation } from '$lib/utils/i18n';

/** Scanner client error codes, plus `connection` when it could not be reached or answered oddly. */
export type ScannerClientPrintErrorCode =
	'PRINTER_NOT_FOUND' | 'PRINT_FAILED' | 'PRINT_TIMEOUT' | 'INVALID_LABELS' | 'connection';

type Messages = {
	printHere: (labelCount: number, printer: string) => string;
	printed: (count: number, printer: string) => string;
	renderFailed: string;
	partiallyPrinted: (count: number) => string;
	failed: Record<ScannerClientPrintErrorCode, (printer: string) => string>;
};

/** Text of the "print on this PC's printer" button (scanner client only). */
export const SCANNER_CLIENT_PRINT_I18N: { th: Messages; en: Messages } = {
	th: {
		printHere: (labelCount, printer) =>
			labelCount > 1
				? `พิมพ์ทั้งครอบครัวที่เครื่องนี้ (${labelCount} ใบ)`
				: `พิมพ์ที่เครื่องนี้ (${printer})`,
		printed: (count, printer) => `พิมพ์ ${count} ใบที่ ${printer}`,
		renderFailed: 'สร้างภาพฉลากไม่สำเร็จ',
		partiallyPrinted: (count) => `(พิมพ์ไปแล้ว ${count} ใบ)`,
		failed: {
			PRINTER_NOT_FOUND: (printer) => `ไม่พบเครื่องพิมพ์ ${printer} ในเครื่องนี้`,
			PRINT_FAILED: (printer) =>
				`ส่งงานพิมพ์ไปที่ ${printer} ไม่สำเร็จ ตรวจสอบสาย กระดาษ และไฟของเครื่องพิมพ์`,
			PRINT_TIMEOUT: (printer) => `เครื่อง ${printer} พิมพ์ช้ากว่ากำหนด กรุณาลองอีกครั้ง`,
			INVALID_LABELS: () => 'ข้อมูลฉลากไม่ถูกต้อง',
			connection: () => 'เชื่อมต่อโปรแกรม scanner client ในเครื่องนี้ไม่ได้'
		}
	},
	en: {
		printHere: (labelCount, printer) =>
			labelCount > 1 ? `Print whole family here (${labelCount} labels)` : `Print here (${printer})`,
		printed: (count, printer) =>
			`Printed ${count} ${count === 1 ? 'label' : 'labels'} at ${printer}`,
		renderFailed: 'Could not render the label',
		partiallyPrinted: (count) => `(${count} already printed)`,
		failed: {
			PRINTER_NOT_FOUND: (printer) => `Printer ${printer} was not found on this PC`,
			PRINT_FAILED: (printer) => `Could not print on ${printer}. Check its cable, paper and power`,
			PRINT_TIMEOUT: (printer) => `${printer} took too long to print. Please try again`,
			INVALID_LABELS: () => 'The label data is invalid',
			connection: () => 'Could not reach the scanner client on this PC'
		}
	}
};

export function scannerClientPrintErrorMessage(
	code: ScannerClientPrintErrorCode,
	printer: string,
	printed: number,
	lang: string | undefined
): string {
	const t = getTranslation(SCANNER_CLIENT_PRINT_I18N, lang);
	const message = t.failed[code](printer);
	return printed > 0 ? `${message} ${t.partiallyPrinted(printed)}` : message;
}
