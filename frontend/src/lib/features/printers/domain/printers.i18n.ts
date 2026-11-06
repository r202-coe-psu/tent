import type { PrintJobStatus } from './print-job.schema';

export const PRINTERS_I18N = {
	th: {
		printed: (count: number, printer: string) => `พิมพ์ ${count} ใบที่ ${printer}`,
		sent: (count: number, printer: string) => `สั่งพิมพ์ ${count} ใบไปที่ ${printer} แล้ว`,
		partiallyPrinted: (count: number) => `(พิมพ์ไปแล้ว ${count} ใบ)`,
		notResponding: (printer: string) => `เครื่อง ${printer} ไม่ตอบ`,
		resultUnknown: (printer: string) =>
			`ไม่ทราบผลการพิมพ์ที่ ${printer} — กดพิมพ์อีกครั้งเพื่อตามผลงานเดิม ระบบจะไม่ส่งฉลากซ้ำ`,
		notPickedUp: (printer: string) => `เครื่อง ${printer} ยังไม่รับงาน — ตรวจสอบว่าเครื่องเปิดอยู่`,
		statusUnknown: (printer: string) => `ยังไม่ทราบผล — ตรวจที่เครื่องพิมพ์ ${printer}`,
		choosePrinter: 'เลือกเครื่องพิมพ์',
		changePrinter: 'เปลี่ยนเครื่อง',
		printerOffline: (printer: string) => `เครื่อง ${printer} ออฟไลน์`,
		printAt: (count: number, printer: string) =>
			count === 1 ? `พิมพ์ที่ ${printer}` : `พิมพ์ ${count} ใบที่ ${printer}`,
		printingProgress: (done: number, total: number) => `กำลังพิมพ์ ${done}/${total}…`,
		printFamily: (count: number) => `พิมพ์ทั้งครอบครัว (${count} ใบ)`,
		retry: 'พิมพ์อีกครั้ง',
		retryLockedTo: (printer: string) =>
			`งานก่อนหน้ายังไม่ทราบผล — พิมพ์อีกครั้งจะส่งไปที่ ${printer} เพื่อไม่ให้พิมพ์ซ้ำ`,
		cancel: 'ยกเลิก',
		cancelled:
			'หยุดส่งงานพิมพ์แล้ว — งานที่ส่งไปแล้วอาจยังพิมพ์ต่อ กดพิมพ์อีกครั้งเพื่อส่งส่วนที่เหลือ',
		renderFailed: 'สร้างภาพฉลากไม่สำเร็จ',
		sendFailed: (printer: string) => `ส่งงานพิมพ์ไปที่ ${printer} ไม่สำเร็จ`,
		forbidden: 'คุณไม่มีสิทธิ์พิมพ์ฉลากในศูนย์นี้',
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
			printer_inactive: (printer: string) =>
				`เครื่อง ${printer} ถูกปิดใช้งาน งานพิมพ์ถูกยกเลิก กรุณาเลือกเครื่องอื่น`,
			printer_deleted: (printer: string) =>
				`เครื่อง ${printer} ถูกลบออกจากระบบ งานพิมพ์ถูกยกเลิก กรุณาเลือกเครื่องอื่น`,
			invalid_label: () => 'รูป label ไม่ถูกต้อง — ลองพิมพ์ใหม่จากหน้านี้',
			unknown: (printer: string) => `พิมพ์ที่เครื่อง ${printer} ไม่สำเร็จ`
		}
	},
	en: {
		printed: (count: number, printer: string) =>
			`Printed ${count} ${count === 1 ? 'label' : 'labels'} at ${printer}`,
		sent: (count: number, printer: string) =>
			`Sent ${count} ${count === 1 ? 'label' : 'labels'} to ${printer}`,
		partiallyPrinted: (count: number) =>
			`(${count} ${count === 1 ? 'label' : 'labels'} already printed)`,
		notResponding: (printer: string) => `${printer} is not responding`,
		resultUnknown: (printer: string) =>
			`Result unknown at ${printer}. Print again to follow up the same job; no labels are sent twice.`,
		notPickedUp: (printer: string) =>
			`${printer} has not picked up the job yet. Check that it is switched on.`,
		statusUnknown: (printer: string) =>
			`Result unknown. Check the printer ${printer} to see if the labels came out.`,
		choosePrinter: 'Choose a printer',
		changePrinter: 'Change printer',
		printerOffline: (printer: string) => `${printer} is offline`,
		printAt: (count: number, printer: string) =>
			count === 1 ? `Print at ${printer}` : `Print ${count} labels at ${printer}`,
		printingProgress: (done: number, total: number) => `Printing ${done}/${total}…`,
		printFamily: (count: number) =>
			`Print whole family (${count} ${count === 1 ? 'label' : 'labels'})`,
		retry: 'Print again',
		retryLockedTo: (printer: string) =>
			`The last job's result is unknown, so printing again goes to ${printer} to avoid duplicates.`,
		cancel: 'Cancel',
		cancelled:
			'Stopped sending. A job already sent may still print. Press print again to send the rest.',
		renderFailed: 'Could not render the labels.',
		sendFailed: (printer: string) => `Could not send the print job to ${printer}.`,
		forbidden: 'You are not allowed to print labels in this shelter.',
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
			printer_inactive: (printer: string) =>
				`${printer} was deactivated and the job was cancelled. Pick another printer.`,
			printer_deleted: (printer: string) =>
				`${printer} was removed and the job was cancelled. Pick another printer.`,
			invalid_label: () => 'The label image is invalid. Try printing again from this page.',
			unknown: (printer: string) => `Printing at ${printer} failed.`
		}
	}
} as const;

export type PrintersI18nLang = keyof typeof PRINTERS_I18N;

export interface PrintJobOutcome {
	/**
	 * `timeout` = the poll window (`PRINT_JOB_POLL_TIMEOUT_MS`) ran out and the job was still open.
	 * `unknown` = the status could not be read at the end of that window, so the tablet does not
	 * know how many labels came out.
	 */
	status: PrintJobStatus | 'timeout' | 'unknown';
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
		case 'unknown':
			return t.resultUnknown(printerName);
		default:
			return t.notResponding(printerName);
	}
}
