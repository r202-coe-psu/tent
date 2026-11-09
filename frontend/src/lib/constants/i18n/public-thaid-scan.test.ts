import { describe, expect, it } from 'vitest';
import { thaidScanMessage } from './public-thaid-scan';

const THAI = /[฀-๿]/;

const ERROR_CASES: {
	name: string;
	error: string | null;
	kiosk: boolean;
	th: string;
	en: RegExp;
}[] = [
	{
		name: 'kiosk invalid_state',
		error: 'invalid_state',
		kiosk: true,
		th: 'ข้อมูลการยืนยันตัวตนไม่ถูกต้องหรือหมดอายุ กรุณาสแกน QR ใหม่ที่ตู้',
		en: /kiosk/i
	},
	{
		name: 'registration invalid_state',
		error: 'invalid_state',
		kiosk: false,
		th: 'ข้อมูลการยืนยันตัวตนไม่ถูกต้องหรือหมดอายุ กรุณาสแกน QR ใหม่จากหน้าจอลงทะเบียน',
		en: /registration screen/i
	},
	{
		name: 'kiosk session_expired',
		error: 'session_expired',
		kiosk: true,
		th: 'QR หมดอายุ กรุณาสร้าง QR ใหม่ที่ตู้',
		en: /expired.*kiosk/i
	},
	{
		name: 'thaid_disabled',
		error: 'thaid_disabled',
		kiosk: false,
		th: 'ระบบยืนยันตัวตน ThaiD ถูกปิดใช้งานชั่วคราว',
		en: /temporarily disabled/i
	},
	{
		name: 'session_expired',
		error: 'session_expired',
		kiosk: false,
		th: 'QR Code นี้หมดอายุแล้ว กรุณาแจ้งผู้ลงทะเบียนหลักเพื่อสร้าง QR Code ใหม่',
		en: /expired.*primary registrant/i
	},
	{
		name: 'missing_session',
		error: 'missing_session',
		kiosk: false,
		th: 'ไม่พบรหัสการเชื่อมต่อ (Invalid Session)',
		en: /session/i
	},
	{
		name: 'unknown error',
		error: 'something_else',
		kiosk: false,
		th: 'การยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
		en: /try again/i
	}
];

describe('thaidScanMessage', () => {
	for (const c of ERROR_CASES) {
		it(`shows the unchanged Thai text for ${c.name} when the language is TH`, () => {
			expect(thaidScanMessage(c.error, 'th', c.kiosk)).toBe(c.th);
		});

		it(`shows English with no Thai text for ${c.name} when the language is EN`, () => {
			const message = thaidScanMessage(c.error, 'en', c.kiosk);
			expect(message).toMatch(c.en);
			expect(message).not.toMatch(THAI);
		});
	}

	it('falls back to Thai for an unsupported language', () => {
		expect(thaidScanMessage('thaid_disabled', 'fr')).toBe(
			'ระบบยืนยันตัวตน ThaiD ถูกปิดใช้งานชั่วคราว'
		);
	});
});
