import type { PrintJobStatus } from './print-job.schema';

export const PRINTERS_I18N = {
	th: {
		printed: (count: number, printer: string) => `พิมพ์ ${count} ใบที่ ${printer}`,
		sent: (count: number, printer: string) => `สั่งพิมพ์ ${count} ใบไปที่ ${printer} แล้ว`,
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
		admin: {
			pageTitle: 'จัดการเครื่องพิมพ์',
			pageDescription:
				'ลงทะเบียนเครื่องพิมพ์ฉลาก (Raspberry Pi + เครื่องพิมพ์) ประจำศูนย์ — สร้าง Device Secret เพื่อให้เครื่องเชื่อมต่อกับระบบ',
			loading: 'กำลังโหลดรายการเครื่องพิมพ์...',
			loadFailed: 'ไม่สามารถโหลดรายการเครื่องพิมพ์ได้',
			register: 'ลงทะเบียนเครื่องพิมพ์ใหม่',
			empty: 'ยังไม่มีเครื่องพิมพ์ในศูนย์นี้',
			emptyHint: 'กดปุ่ม "ลงทะเบียนเครื่องพิมพ์ใหม่" ด้านบนเพื่อเพิ่มเครื่อง',
			columns: {
				printer: 'เครื่องพิมพ์',
				station: 'จุดบริการ',
				status: 'สถานะ',
				queue: 'คิวพิมพ์',
				lastJob: 'งานล่าสุด',
				manage: 'จัดการ'
			},
			manage: 'จัดการ',
			manageSr: (name: string) => `เครื่อง ${name}`,
			inactive: 'ปิดใช้งาน',
			noStation: 'ไม่ระบุจุดบริการ',
			neverSeen: 'ยังไม่เคยเชื่อมต่อ',
			secretPrefix: (prefix: string) => `Secret ${prefix}…`,
			localIps: (ips: readonly string[]) => `IP ${ips.join(', ')}`,
			noLocalIps: 'ยังไม่ทราบ IP',
			queueState: {
				ready: 'พร้อมใช้งาน',
				disabled: 'คิวถูกปิด',
				missing: 'ไม่พบคิว',
				unknown: 'ไม่ทราบสถานะ'
			},
			noJob: 'ยังไม่มีงานพิมพ์',
			jobStatus: {
				pending: 'รอพิมพ์',
				printing: 'กำลังพิมพ์',
				printed: 'พิมพ์สำเร็จ',
				failed: 'พิมพ์ไม่สำเร็จ',
				expired: 'หมดอายุ'
			},
			create: {
				title: 'ลงทะเบียนเครื่องพิมพ์',
				description: 'เพิ่มเครื่องพิมพ์ฉลากใหม่และสร้าง Device Secret สำหรับเชื่อมต่อ',
				deviceId: 'Device ID',
				deviceIdPlaceholder: 'เช่น printer-sh001-reg1',
				deviceIdHint: 'ตัวพิมพ์เล็ก ตัวเลข และ - ยาว 3–63 ตัวอักษร',
				name: 'ชื่อเครื่อง',
				namePlaceholder: 'เช่น โต๊ะลงทะเบียน 1',
				station: 'จุดบริการ',
				stationPlaceholder: 'เช่น ลงทะเบียน',
				hostKind: 'รูปแบบการติดตั้ง',
				hostKinds: { standalone: 'Pi แยกเครื่อง', kiosk: 'ติดตั้งในตู้ kiosk' },
				cancel: 'ยกเลิก',
				submit: 'สร้างและรับ Secret',
				submitting: 'กำลังบันทึก...',
				chooseShelter: 'กรุณาเลือกศูนย์พักพิง',
				success: 'ลงทะเบียนเครื่องพิมพ์สำเร็จ',
				failed: 'เกิดข้อผิดพลาดในการลงทะเบียนเครื่องพิมพ์',
				invalid: 'ข้อมูลไม่ถูกต้อง',
				conflict: 'Device ID นี้ถูกใช้แล้ว'
			},
			reveal: {
				createdTitle: 'ลงทะเบียนเครื่องพิมพ์สำเร็จ',
				rotatedTitle: 'ออก Device Secret ใหม่แล้ว',
				description:
					'นำค่าด้านล่างไปใส่ในไฟล์ .env ของโปรแกรม printer บนเครื่อง Pi — Secret นี้แสดงครั้งเดียว',
				warningTitle: 'เก็บเป็นความลับ',
				warning:
					'Device Secret เปรียบเสมือนรหัสผ่านของเครื่องพิมพ์ ระบบจะไม่แสดงซ้ำอีก หากปิดหน้าต่างแล้วต้องออก Secret ใหม่',
				secretLabel: 'Device Secret',
				copy: 'คัดลอก',
				copySecretDone: 'คัดลอก Device Secret แล้ว',
				copyEnv: 'คัดลอก .env',
				copyEnvDone: 'คัดลอก .env config snippet แล้ว',
				copyFailed: 'ไม่สามารถคัดลอกได้',
				envLabel: 'ตัวอย่างไฟล์ .env สำหรับเครื่อง Pi:',
				close: 'ปิดหน้าต่าง'
			},
			edit: {
				title: 'จัดการเครื่องพิมพ์',
				infoSection: 'ข้อมูลเครื่อง',
				name: 'ชื่อเครื่อง',
				station: 'จุดบริการ',
				activeLabel: 'เปิดใช้งานเครื่อง',
				activeOn: 'Active — รับงานพิมพ์ได้',
				activeOff: 'Inactive — ไม่รับงานพิมพ์จนกว่าจะเปิดอีกครั้ง',
				connectionSection: 'การเชื่อมต่อและทดสอบ',
				rotate: 'ออก Secret ใหม่',
				rotateHint: 'เครื่องเดิมที่ใช้ Secret เก่าจะเชื่อมต่อไม่ได้ทันที',
				rotateDone: 'ออก Device Secret ใหม่แล้ว',
				testPrint: 'พิมพ์ทดสอบ',
				testPrintHint: 'ส่งฉลากทดสอบ (ไม่มีข้อมูลบุคคล) ไปที่เครื่องนี้',
				testPrintSent: (name: string) => `ส่งงานพิมพ์ทดสอบไปที่ ${name} แล้ว`,
				testPrintOffline: (name: string) => `เครื่อง ${name} ออฟไลน์ พิมพ์ทดสอบไม่ได้`,
				deleteSection: 'ลบเครื่องนี้',
				deleteHint: 'งานพิมพ์ที่ค้างอยู่จะถูกยกเลิก และย้อนกลับไม่ได้',
				delete: 'ลบเครื่อง',
				deleteConfirmTitle: 'ยืนยันการลบเครื่องพิมพ์',
				deleteConfirmBody: (name: string, id: string) => `ลบเครื่อง ${name} (${id}) ออกจากระบบ`,
				deleteConfirmWarning:
					'ลบแล้วย้อนกลับไม่ได้ เครื่อง Pi จะเชื่อมต่อไม่ได้อีก ถ้าต้องการใช้ต่อต้องลงทะเบียนใหม่',
				deleting: 'กำลังลบ...',
				deleted: 'ลบเครื่องพิมพ์เรียบร้อยแล้ว',
				cancel: 'ยกเลิก',
				save: 'บันทึก',
				saving: 'กำลังบันทึก...',
				saved: (name: string) => `บันทึกการตั้งค่าเครื่อง ${name} แล้ว`,
				saveFailed: 'ไม่สามารถบันทึกการตั้งค่าเครื่องได้',
				actionFailed: 'ดำเนินการไม่สำเร็จ'
			}
		},
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
		admin: {
			pageTitle: 'Manage label printers',
			pageDescription:
				'Register the shelter label printers (Raspberry Pi + printer) and issue the Device Secret each one connects with.',
			loading: 'Loading printers...',
			loadFailed: 'Could not load the printers.',
			register: 'Register a new printer',
			empty: 'No printers in this shelter yet',
			emptyHint: 'Press "Register a new printer" above to add one.',
			columns: {
				printer: 'Printer',
				station: 'Station',
				status: 'Status',
				queue: 'Print queue',
				lastJob: 'Last job',
				manage: 'Manage'
			},
			manage: 'Manage',
			manageSr: (name: string) => `printer ${name}`,
			inactive: 'Disabled',
			noStation: 'No station',
			neverSeen: 'Never connected',
			secretPrefix: (prefix: string) => `Secret ${prefix}…`,
			localIps: (ips: readonly string[]) => `IP ${ips.join(', ')}`,
			noLocalIps: 'IP not known yet',
			queueState: {
				ready: 'Ready',
				disabled: 'Queue disabled',
				missing: 'Queue missing',
				unknown: 'Unknown'
			},
			noJob: 'No print jobs yet',
			jobStatus: {
				pending: 'Pending',
				printing: 'Printing',
				printed: 'Printed',
				failed: 'Failed',
				expired: 'Expired'
			},
			create: {
				title: 'Register a printer',
				description: 'Add a new label printer and issue its Device Secret.',
				deviceId: 'Device ID',
				deviceIdPlaceholder: 'e.g. printer-sh001-reg1',
				deviceIdHint: 'Lowercase letters, digits and -, 3 to 63 characters',
				name: 'Printer name',
				namePlaceholder: 'e.g. Registration desk 1',
				station: 'Station',
				stationPlaceholder: 'e.g. Registration',
				hostKind: 'Installation',
				hostKinds: { standalone: 'Standalone Pi', kiosk: 'Inside a kiosk' },
				cancel: 'Cancel',
				submit: 'Create and get Secret',
				submitting: 'Saving...',
				chooseShelter: 'Choose a shelter',
				success: 'Printer registered',
				failed: 'Could not register the printer',
				invalid: 'Invalid data',
				conflict: 'This Device ID is already in use'
			},
			reveal: {
				createdTitle: 'Printer registered',
				rotatedTitle: 'New Device Secret issued',
				description:
					'Put these values in the .env of the printer program on the Pi. The secret is shown only once.',
				warningTitle: 'Keep it secret',
				warning:
					'The Device Secret works like the printer password. It will not be shown again; issue a new one if you close this window without copying it.',
				secretLabel: 'Device Secret',
				copy: 'Copy',
				copySecretDone: 'Device Secret copied',
				copyEnv: 'Copy .env',
				copyEnvDone: '.env snippet copied',
				copyFailed: 'Could not copy',
				envLabel: 'Example .env for the Pi:',
				close: 'Close'
			},
			edit: {
				title: 'Manage printer',
				infoSection: 'Printer details',
				name: 'Printer name',
				station: 'Station',
				activeLabel: 'Enable printer',
				activeOn: 'Active — accepts print jobs',
				activeOff: 'Inactive — no print jobs until enabled again',
				connectionSection: 'Connection and test',
				rotate: 'Issue a new Secret',
				rotateHint: 'The Pi using the old secret is cut off immediately',
				rotateDone: 'New Device Secret issued',
				testPrint: 'Test print',
				testPrintHint: 'Send a test label (no personal data) to this printer',
				testPrintSent: (name: string) => `Test print sent to ${name}`,
				testPrintOffline: (name: string) => `${name} is offline, cannot test print`,
				deleteSection: 'Delete this printer',
				deleteHint: 'Pending jobs are cancelled. This cannot be undone.',
				delete: 'Delete printer',
				deleteConfirmTitle: 'Delete this printer?',
				deleteConfirmBody: (name: string, id: string) => `Remove ${name} (${id}) from the system.`,
				deleteConfirmWarning:
					'This cannot be undone. The Pi can no longer connect; register it again to reuse it.',
				deleting: 'Deleting...',
				deleted: 'Printer deleted',
				cancel: 'Cancel',
				save: 'Save',
				saving: 'Saving...',
				saved: (name: string) => `Saved settings of ${name}`,
				saveFailed: 'Could not save the printer settings',
				actionFailed: 'Action failed'
			}
		},
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
			unknown: (printer: string) => `Printing at ${printer} failed.`
		}
	}
} as const;

export type PrintersI18nLang = keyof typeof PRINTERS_I18N;

export interface PrintJobOutcome {
	/** `timeout` = the client gave up polling (`PRINT_JOB_POLL_TIMEOUT_MS`) before a final status. */
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
