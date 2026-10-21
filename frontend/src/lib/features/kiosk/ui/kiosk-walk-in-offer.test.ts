import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import KioskWalkInOffer from './kiosk-walk-in-offer.svelte';

const defaultProps = {
	isLookingUp: false,
	retryAfterSeconds: 0,
	onregister: vi.fn(),
	onretry: vi.fn()
};

describe('KioskWalkInOffer', () => {
	it('leads with registering at the kiosk and keeps searching again available', () => {
		const { body } = render(KioskWalkInOffer, { props: defaultProps });

		expect(body).toContain('ลงทะเบียนที่ตู้นี้');
		expect(body).toContain('ลงทะเบียนล่วงหน้าไว้แล้ว? ค้นหาอีกครั้ง');
		expect(body.indexOf('ลงทะเบียนที่ตู้นี้<')).toBeLessThan(body.indexOf('ค้นหาอีกครั้ง'));
	});

	it('holds the search-again button while rate limited', () => {
		const { body } = render(KioskWalkInOffer, {
			props: { ...defaultProps, retryAfterSeconds: 42 }
		});

		expect(body).toContain('ค้นหาอีกครั้งได้ใน');
		expect(body).toContain('42');
		expect(body).toMatch(/<button[^>]*disabled[^>]*>[^]*?ค้นหาอีกครั้งได้ใน/);
	});

	it('says the details come from the card, or from ThaiD without a photo', () => {
		const card = render(KioskWalkInOffer, { props: defaultProps }).body;
		const thaid = render(KioskWalkInOffer, { props: { ...defaultProps, source: 'thaid' } }).body;

		expect(card).toContain('บัตรประชาชนที่เสียบอยู่');
		expect(thaid).toContain('ยืนยันผ่าน ThaiD (ไม่มีรูปถ่าย)');
		expect(thaid).not.toContain('บัตรประชาชนที่เสียบอยู่');
	});
});
