import type { PrintJobStatus } from './print-job.schema';

export const PRINTERS_I18N = {
	th: {
		printed: (count: number, printer: string) => `พิมพ์ ${count} ใบที่ ${printer}`,
		partiallyPrinted: (count: number) => `(พิมพ์ไปแล้ว ${count} ใบ)`,
		notResponding: (printer: string) => `เครื่อง ${printer} ไม่ตอบ`,
		choosePrinter: 'เลือกเครื่องพิมพ์',
		changePrinter: 'เปลี่ยนเครื่อง',
		printerOffline: (printer: string) => `เครื่อง ${printer} ออฟไลน์`,
		printAt: (count: number, printer: string) =>
			count === 1 ? `พิมพ์ที่ ${printer}` : `พิมพ์ ${count} ใบที่ ${printer}`,
		printingProgress: (done: number, total: number) => `กำลังพิมพ์ ${done}/${total}…`,
		retry: 'พิมพ์อีกครั้ง',
		renderFailed: 'สร้างภาพฉลากไม่สำเร็จ',
		sendFailed: (printer: string) => `ส่งงานพิมพ์ไปที่ ${printer} ไม่สำเร็จ`,
		online: 'ออนไลน์',
		offline: 'ออฟไลน์',
		disconnectedHint: 'พิมพ์ผ่านเครื่องพิมพ์ไม่ได้ขณะออฟไลน์ — ใช้พรีวิว PDF',
		failed: {
			printer_timeout: (printer: string) =>
				`เครื่อง ${printer} พิมพ์ไม่เสร็จในเวลาที่กำหนด ตรวจสอบกระดาษและสายไฟ`,
			queue_disabled: (printer: string) =>
				`คิวพิมพ์ของเครื่อง ${printer} ถูกปิดอยู่ กรุณาแจ้งผู้ดูแลระบบ`,
			lp_failed: (printer: string) => `สั่งพิมพ์ที่เครื่อง ${printer} ไม่สำเร็จ`,
			agent_restart: (printer: string) =>
				`เครื่อง ${printer} เพิ่งรีสตาร์ท งานพิมพ์ถูกยกเลิก กรุณาพิมพ์อีกครั้ง`,
			lease_expired: (printer: string) =>
				`เครื่อง ${printer} ไม่ส่งผลการพิมพ์กลับมา ตรวจสอบเครื่องแล้วพิมพ์อีกครั้ง`,
			unknown: (printer: string) => `พิมพ์ที่เครื่อง ${printer} ไม่สำเร็จ`
		}
	},
	en: {
		printed: (count: number, printer: string) =>
			`Printed ${count} ${count === 1 ? 'label' : 'labels'} at ${printer}`,
		partiallyPrinted: (count: number) =>
			`(${count} ${count === 1 ? 'label' : 'labels'} already printed)`,
		notResponding: (printer: string) => `${printer} is not responding`,
		choosePrinter: 'Choose a printer',
		changePrinter: 'Change printer',
		printerOffline: (printer: string) => `${printer} is offline`,
		printAt: (count: number, printer: string) =>
			count === 1 ? `Print at ${printer}` : `Print ${count} labels at ${printer}`,
		printingProgress: (done: number, total: number) => `Printing ${done}/${total}…`,
		retry: 'Print again',
		renderFailed: 'Could not render the labels.',
		sendFailed: (printer: string) => `Could not send the print job to ${printer}.`,
		online: 'Online',
		offline: 'Offline',
		disconnectedHint: 'Cannot print through a label printer while offline. Use the PDF preview.',
		failed: {
			printer_timeout: (printer: string) =>
				`${printer} did not finish printing in time. Check paper and power.`,
			queue_disabled: (printer: string) =>
				`The print queue on ${printer} is disabled. Contact an administrator.`,
			lp_failed: (printer: string) => `Could not send the job to ${printer}.`,
			agent_restart: (printer: string) =>
				`${printer} just restarted and the job was cancelled. Print again.`,
			lease_expired: (printer: string) =>
				`${printer} never reported back. Check the printer, then print again.`,
			unknown: (printer: string) => `Printing at ${printer} failed.`
		}
	}
} as const;

export type PrintersI18nLang = keyof typeof PRINTERS_I18N;

export interface PrintJobOutcome {
	/** `timeout` = the client gave up polling (60 s) before the job reached a final status. */
	status: PrintJobStatus | 'timeout';
	printed: number;
	error_code: string | null;
}

function failureMessage(
	table: (typeof PRINTERS_I18N)[PrintersI18nLang]['failed'],
	errorCode: string | null,
	printer: string
): string {
	if (errorCode !== null && Object.hasOwn(table, errorCode) && errorCode !== 'unknown') {
		return table[errorCode as keyof typeof table](printer);
	}
	return table.unknown(printer);
}

/** Toast copy for a finished (or abandoned) print job — plan §6.3. */
export function printJobOutcomeMessage(
	result: PrintJobOutcome,
	printerName: string,
	lang: PrintersI18nLang
): string {
	const t = PRINTERS_I18N[lang];
	switch (result.status) {
		case 'printed':
			return t.printed(result.printed, printerName);
		case 'failed': {
			const message = failureMessage(t.failed, result.error_code, printerName);
			return result.printed > 0 ? `${message} ${t.partiallyPrinted(result.printed)}` : message;
		}
		default:
			return t.notResponding(printerName);
	}
}
