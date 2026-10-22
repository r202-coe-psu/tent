import { describe, expect, it } from 'vitest';
import { printJobOutcomeMessage } from './printers.i18n';

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
		[null, 'พิมพ์ที่เครื่อง โต๊ะ 1 ไม่สำเร็จ'],
		['something_new', 'พิมพ์ที่เครื่อง โต๊ะ 1 ไม่สำเร็จ']
	])('explains a failed job with error_code %s', (error_code, expected) => {
		expect(
			printJobOutcomeMessage({ status: 'failed', printed: 0, error_code }, 'โต๊ะ 1', 'th')
		).toBe(expected);
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
