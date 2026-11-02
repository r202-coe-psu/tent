import { describe, expect, it } from 'vitest';
import { PRINTERS_I18N, printerAdminErrorMessage, printJobOutcomeMessage } from './printers.i18n';

describe('printFamily', () => {
	it('labels the whole-family print button with the number of labels', () => {
		expect(PRINTERS_I18N.th.printFamily(4)).toBe('พิมพ์ทั้งครอบครัว (4 ใบ)');
		expect(PRINTERS_I18N.en.printFamily(4)).toBe('Print whole family (4 labels)');
		expect(PRINTERS_I18N.en.printFamily(1)).toBe('Print whole family (1 label)');
	});
});

describe('printJobOutcomeMessage', () => {
	it('reports how many labels were printed and where', () => {
		const result = { status: 'printed', printed: 4, error_code: null } as const;
		expect(printJobOutcomeMessage(result, 'โต๊ะ 1', 'th')).toBe('พิมพ์ 4 ใบที่ โต๊ะ 1');
		expect(printJobOutcomeMessage(result, 'Desk 1', 'en')).toBe('Printed 4 labels at Desk 1');
		expect(
			printJobOutcomeMessage({ status: 'printed', printed: 1, error_code: null }, 'Desk 1', 'en')
		).toBe('Printed 1 label at Desk 1');
	});

	it.each([
		['printer_timeout', 'เครื่อง โต๊ะ 1 พิมพ์ไม่เสร็จในเวลาที่กำหนด ตรวจสอบกระดาษและสายไฟ'],
		['queue_disabled', 'คิวพิมพ์ของเครื่อง โต๊ะ 1 ถูกปิดอยู่ กรุณาแจ้งผู้ดูแลระบบ'],
		['lp_failed', 'สั่งพิมพ์ที่เครื่อง โต๊ะ 1 ไม่สำเร็จ'],
		['agent_restart', 'เครื่อง โต๊ะ 1 เพิ่งรีสตาร์ท งานพิมพ์ถูกยกเลิก กรุณาพิมพ์อีกครั้ง'],
		['lease_expired', 'เครื่อง โต๊ะ 1 ไม่ส่งผลการพิมพ์กลับมา ตรวจสอบเครื่องแล้วพิมพ์อีกครั้ง'],
		['printer_inactive', 'เครื่อง โต๊ะ 1 ถูกปิดใช้งาน งานพิมพ์ถูกยกเลิก กรุณาเลือกเครื่องอื่น'],
		['printer_deleted', 'เครื่อง โต๊ะ 1 ถูกลบออกจากระบบ งานพิมพ์ถูกยกเลิก กรุณาเลือกเครื่องอื่น'],
		['invalid_label', 'รูป label ไม่ถูกต้อง — ลองพิมพ์ใหม่จากหน้านี้'],
		[null, 'พิมพ์ที่เครื่อง โต๊ะ 1 ไม่สำเร็จ'],
		['something_new', 'พิมพ์ที่เครื่อง โต๊ะ 1 ไม่สำเร็จ']
	])('explains a failed job with error_code %s', (error_code, expected) => {
		expect(
			printJobOutcomeMessage({ status: 'failed', printed: 0, error_code }, 'โต๊ะ 1', 'th')
		).toBe(expected);
	});

	it('explains invalid_label in English', () => {
		expect(
			printJobOutcomeMessage(
				{ status: 'failed', printed: 0, error_code: 'invalid_label' },
				'Desk 1',
				'en'
			)
		).toBe('The label image is invalid. Try printing again from this page.');
	});

	it('tells how many labels already came out when a job failed part-way', () => {
		expect(
			printJobOutcomeMessage(
				{ status: 'failed', printed: 2, error_code: 'printer_timeout' },
				'Desk 1',
				'en'
			)
		).toBe(
			'Desk 1 did not finish printing in time. Check paper and power. (2 labels already printed)'
		);
	});

	it.each(['expired', 'timeout'] as const)('says the printer did not answer on %s', (status) => {
		const result = { status, printed: 0, error_code: null };
		expect(printJobOutcomeMessage(result, 'โต๊ะ 1', 'th')).toBe('เครื่อง โต๊ะ 1 ไม่ตอบ');
		expect(printJobOutcomeMessage(result, 'Desk 1', 'en')).toBe('Desk 1 is not responding');
	});
});

describe('printerAdminErrorMessage', () => {
	it.each([
		['KIOSK_DEVICE_NOT_FOUND', 'ไม่พบตู้ kiosk นี้ในศูนย์ของเครื่องพิมพ์'],
		['KIOSK_DEVICE_REQUIRES_KIOSK_HOST', 'เลือกตู้ kiosk ได้เฉพาะเครื่องที่ติดตั้งในตู้ kiosk']
	])('explains the %s kiosk link error in Thai', (code, expected) => {
		expect(printerAdminErrorMessage(code, 'th')).toBe(expected);
	});

	it('explains the kiosk link errors in English', () => {
		expect(printerAdminErrorMessage('KIOSK_DEVICE_NOT_FOUND', 'en')).toBe(
			'That kiosk was not found in the printer shelter.'
		);
		expect(printerAdminErrorMessage('KIOSK_DEVICE_REQUIRES_KIOSK_HOST', 'en')).toBe(
			'A kiosk can only be linked to a printer installed inside a kiosk.'
		);
	});

	it('returns null for a code it has no copy for so the caller keeps the server message', () => {
		expect(printerAdminErrorMessage('SOMETHING_ELSE', 'th')).toBeNull();
		expect(printerAdminErrorMessage(null, 'th')).toBeNull();
	});
});
