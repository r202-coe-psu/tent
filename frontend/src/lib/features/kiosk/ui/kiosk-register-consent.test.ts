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
		expect(body.indexOf('ข้อตกลงและความยินยอม')).toBeGreaterThan(
			body.indexOf('ยินยอมให้อ่านข้อมูลจากบัตรประชาชน')
		);
		expect(body).toContain('ยอมรับทั้งหมด');
		expect(body).toContain('ยืนยัน');
		expect(body).toContain('ยกเลิก');
		expect(body).not.toContain('ไม่ยินยอม');
	});

	it('disables the confirm button until the first consent is ticked', () => {
		const { body } = render(KioskRegisterConsent, {
			props: { onconsent: noop, oncancel: noop }
		});
		const confirmButton = body.match(/<button[^>]*>(?:<!---->)?ยืนยัน(?:<!---->)?<\/button>/);

		expect(confirmButton).not.toBeNull();
		expect(confirmButton?.[0]).toContain('disabled');
		expect(body).toContain('กรุณายินยอมข้อแรกก่อนบันทึก');
	});

	it('does not link to the term and policy pages on the kiosk', () => {
		const { body } = render(KioskRegisterConsent, {
			props: { onconsent: noop, oncancel: noop }
		});

		expect(body).not.toContain('href="/term"');
		expect(body).not.toContain('href="/policy"');
		expect(body).not.toContain('ข้อตกลงการใช้งาน');
		expect(body).not.toContain('นโยบายความเป็นส่วนตัว');
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
