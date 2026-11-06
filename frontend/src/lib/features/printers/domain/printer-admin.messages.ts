/** The part of a Zod issue the create dialog needs to pick its copy. */
export interface PrinterCreateIssue {
	readonly path: readonly PropertyKey[];
	readonly code: string;
}

/**
 * Thai copy for the first problem `printerCreateInputSchema` finds, so the dialog never toasts
 * the schema's English messages. Unmapped issues get the generic "invalid data" copy.
 */
export function printerCreateIssueMessage(issue: PrinterCreateIssue): string {
	switch (issue.path[0]) {
		case 'device_id':
			return 'Device ID ต้องเป็นตัวพิมพ์เล็ก ตัวเลข และ - ยาว 3–63 ตัวอักษร';
		case 'name':
			return issue.code === 'too_big' ? 'ชื่อเครื่องยาวเกิน 80 ตัวอักษร' : 'กรุณากรอกชื่อเครื่อง';
		default:
			return 'ข้อมูลไม่ถูกต้อง';
	}
}

/** BFF `SHELTER_CLOSED` (O-11): a closed or cancelled shelter gets no new or reactivated printer. */
export const SHELTER_CLOSED_MESSAGE =
	'ศูนย์นี้ปิดหรือถูกยกเลิกแล้ว จึงลงทะเบียนหรือเปิดใช้เครื่องพิมพ์ไม่ได้';
