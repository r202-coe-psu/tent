import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import KioskRegisterConsent from './kiosk-register-consent.svelte';

const noop = () => {};

describe('KioskRegisterConsent', () => {
	it('keeps what is read from the card above the PDPA block', () => {
		const { body } = render(KioskRegisterConsent, {
			props: { source: 'smart-card', onconsent: noop, oncancel: noop }
		});

		expect(body.indexOf('ยินยอมให้อ่านข้อมูลจากบัตรประชาชน')).toBeGreaterThan(-1);
		expect(body.indexOf('ความยินยอมของท่าน')).toBeGreaterThan(
			body.indexOf('ยินยอมให้อ่านข้อมูลจากบัตรประชาชน')
		);
		expect(body).toContain('ยืนยัน');
		expect(body).toContain('ไม่ยินยอม');
		expect(body).toContain('ยกเลิก');
	});

	it('names ThaiD as the source for a ThaiD walk-in', () => {
		const { body } = render(KioskRegisterConsent, {
			props: { source: 'thaid', onconsent: noop, oncancel: noop }
		});

		expect(body).toContain('ยินยอมให้ใช้ข้อมูลจาก ThaiD');
		expect(body).not.toContain('ชิปบัตร');
	});

	it('offers neither the guardian nor the verbal row on the kiosk', () => {
		const { body } = render(KioskRegisterConsent, {
			props: { onconsent: noop, oncancel: noop }
		});

		expect(body).not.toContain('ผู้ใช้อำนาจปกครอง');
		expect(body).not.toContain('เจ้าหน้าที่อ่านข้อความนี้');
	});
});
