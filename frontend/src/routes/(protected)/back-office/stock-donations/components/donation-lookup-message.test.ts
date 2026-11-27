import { describe, expect, it } from 'vitest';
import { donationLookupFailedMessage } from './donation-lookup-message';

describe('donationLookupFailedMessage', () => {
	it.each([
		[404, 'ไม่พบใบจองบริจาค “DN-1” — ตรวจรหัสอีกครั้ง'],
		[403, 'ใบจอง “DN-1” เป็นของศูนย์อื่น — รับเข้าที่ศูนย์นี้ไม่ได้'],
		[500, 'ตรวจสอบใบจองไม่สำเร็จ กรุณาลองใหม่อีกครั้ง']
	])('explains a %i lookup in Thai', (status, message) => {
		expect(donationLookupFailedMessage(status, 'DN-1')).toBe(message);
	});
});
