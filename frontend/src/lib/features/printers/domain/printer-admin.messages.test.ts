import { describe, expect, it } from 'vitest';
import { printerCreateInputSchema } from './print-device.schema';
import { printerCreateIssueMessage } from './printer-admin.messages';

describe('printerCreateIssueMessage', () => {
	const base = {
		device_id: 'printer-sh001-a',
		name: 'Desk 1',
		shelter_code: 'SH001'
	};
	const firstIssue = (input: Record<string, unknown>) => {
		const parsed = printerCreateInputSchema.safeParse({ ...base, ...input });
		if (parsed.success) throw new Error('expected the input to be rejected');
		return parsed.error.issues[0];
	};

	it.each([
		[{ device_id: 'AB' }, 'Device ID ต้องเป็นตัวพิมพ์เล็ก ตัวเลข และ - ยาว 3–63 ตัวอักษร'],
		[{ name: '   ' }, 'กรุณากรอกชื่อเครื่อง'],
		[{ name: 'x'.repeat(81) }, 'ชื่อเครื่องยาวเกิน 80 ตัวอักษร'],
		[{ shelter_code: '' }, 'ข้อมูลไม่ถูกต้อง']
	])('explains %j', (input, expected) => {
		expect(printerCreateIssueMessage(firstIssue(input))).toBe(expected);
	});
});
