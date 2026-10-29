import { describe, expect, it } from 'vitest';
import { maskDonorEmail, maskDonorName, maskDonorPhone } from './donor-contact';

describe('maskDonorName', () => {
	it('keeps the first name and masks the surname with ****, like the kiosk cards', () => {
		expect(maskDonorName('สมชาย ใจดี')).toBe('สมชาย ใ****');
		expect(maskDonorName('John Smithson')).toBe('John Sm****n');
	});

	it('keeps a single word and names a blank donor', () => {
		expect(maskDonorName('ทดสอบ')).toBe('ทดสอบ');
		expect(maskDonorName('  ')).toBe('ไม่ระบุชื่อ');
		expect(maskDonorName(null)).toBe('ไม่ระบุชื่อ');
	});
});

describe('maskDonorPhone', () => {
	it('keeps only the last four digits, like the backend mask', () => {
		expect(maskDonorPhone('0812345678')).toBe('xxx-xxx-5678');
		expect(maskDonorPhone('081-234-5678')).toBe('xxx-xxx-5678');
	});

	it('hides everything when there are fewer than four digits', () => {
		expect(maskDonorPhone(null)).toBe('xxx-xxx-xxxx');
		expect(maskDonorPhone('12')).toBe('xxx-xxx-xxxx');
	});
});

describe('maskDonorEmail', () => {
	it('keeps the first and last letter of the local part and the domain', () => {
		expect(maskDonorEmail('somchai@example.com')).toBe('s***i@example.com');
	});

	it('keeps only the first letter of a short local part', () => {
		expect(maskDonorEmail('ab@b.th')).toBe('a***@b.th');
	});

	it('returns null or the value itself when there is nothing to mask', () => {
		expect(maskDonorEmail(null)).toBeNull();
		expect(maskDonorEmail('not-an-email')).toBe('not-an-email');
	});
});
