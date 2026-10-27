import { describe, expect, it } from 'vitest';
import type { PendingDonationRow } from './back-office';
import {
	maskDonorEmail,
	maskDonorName,
	maskDonorPhone,
	matchesReceivedSearch
} from './donor-contact';

const row = (over: Partial<PendingDonationRow> = {}): PendingDonationRow => ({
	booking_ref: 'DN-212033',
	shelter_code: 'SH001',
	status: 'received',
	donor_name: 'สมชาย ใจดี',
	donor_phone: '0812345678',
	donor_email: 'somchai@example.com',
	item_count: 1,
	items: [{ free_text: 'ข้าวสาร', qty: '10', unit: 'kg' }],
	...over
});

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

describe('matchesReceivedSearch', () => {
	it('matches everything on an empty query', () => {
		expect(matchesReceivedSearch(row(), '  ')).toBe(true);
	});

	it('matches the booking ref, donor name and item name, ignoring case', () => {
		expect(matchesReceivedSearch(row(), 'dn-212033')).toBe(true);
		expect(matchesReceivedSearch(row(), 'สมชาย')).toBe(true);
		expect(matchesReceivedSearch(row(), 'ข้าว')).toBe(true);
	});

	it('matches a phone by its last digits or the full number with separators', () => {
		expect(matchesReceivedSearch(row(), '5678')).toBe(true);
		expect(matchesReceivedSearch(row(), '081-234-5678')).toBe(true);
		expect(matchesReceivedSearch(row(), '+66812345678')).toBe(true);
	});

	it('does not match on fewer than four digits or a different number', () => {
		expect(matchesReceivedSearch(row(), '56')).toBe(false);
		expect(matchesReceivedSearch(row(), '0899999999')).toBe(false);
		expect(matchesReceivedSearch(row({ donor_phone: null }), '5678')).toBe(false);
	});
});
