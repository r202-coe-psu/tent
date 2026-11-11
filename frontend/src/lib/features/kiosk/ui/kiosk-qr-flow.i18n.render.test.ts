import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { languageStore } from '$lib/stores/language.svelte';
import KioskRegisterConsent from './kiosk-register-consent.svelte';
import PhoneHouseholdPicker from './phone-household-picker.svelte';
import KioskRegisterPhone from './kiosk-register-phone.svelte';

const THAI = /[฀-๿]/;
const noop = () => {};

afterEach(() => languageStore.setLanguage('th'));

describe('KioskRegisterPhone language', () => {
	it('asks for the phone in English, with the way on without one, and no Thai', () => {
		languageStore.setLanguage('en');

		const { body } = render(KioskRegisterPhone, { props: { onconfirm: noop } });

		expect(body).toContain('Contact phone number');
		expect(body).toContain('Confirm this number');
		expect(body).toContain('No phone');
		expect(body).toContain('aria-label="Phone number entered"');
		expect(body).not.toMatch(THAI);
	});

	it('keeps the Thai copy byte-identical in Thai', () => {
		const { body } = render(KioskRegisterPhone, { props: { onconfirm: noop } });

		expect(body).toContain('เบอร์โทรศัพท์ที่ติดต่อได้');
		expect(body).toContain('เจ้าหน้าที่จะใช้ติดต่อคุณ ถ้าไม่มีเบอร์ กด「ไม่มีเบอร์」ได้เลย');
		expect(body).toContain('aria-label="เบอร์โทรศัพท์ที่กรอก"');
		expect(body).toContain('ยืนยันเบอร์นี้');
	});
});

describe('KioskRegisterConsent language', () => {
	const consentProps = { onconsent: noop, oncancel: noop };

	it('explains the card read in English above the English PDPA block, with no Thai', () => {
		languageStore.setLanguage('en');

		const { body } = render(KioskRegisterConsent, {
			props: { source: 'smart-card', ...consentProps }
		});

		expect(body).toContain('Before you register');
		expect(body).toContain('Consent to read data from your ID card');
		expect(body).toContain('Terms and Privacy Policy');
		expect(body).toContain('Accept all');
		expect(body).toContain('Cancel');
		expect(body).not.toMatch(THAI);
	});

	it('words the ThaiD source in English too', () => {
		languageStore.setLanguage('en');

		const { body } = render(KioskRegisterConsent, { props: { source: 'thaid', ...consentProps } });

		expect(body).toContain('Consent to use your ThaiD data');
		expect(body).not.toMatch(THAI);
	});

	it('keeps the Thai copy byte-identical in Thai', () => {
		const { body } = render(KioskRegisterConsent, {
			props: { source: 'smart-card', ...consentProps }
		});

		expect(body).toContain('ก่อนเริ่มลงทะเบียน');
		expect(body).toContain('ยินยอมให้อ่านข้อมูลจากบัตรประชาชน');
		expect(body).toContain(
			'ข้อมูลจะถูกเก็บในรายการที่รอยืนยัน และเจ้าหน้าที่จะตรวจสอบข้อมูลเมื่อท่านไปพบเจ้าหน้าที่'
		);
		expect(body).toContain(
			'กรุณาเสียบบัตรของผู้ที่ต้องการลงทะเบียน เมื่อหน้าจอแจ้งว่าลงทะเบียนสำเร็จแล้วจึงนำบัตรออก'
		);
	});
});

describe('PhoneHouseholdPicker language', () => {
	const candidates = [
		{ primary_evacuee_id: 'e1', contact_display: 'สมชาย ใ***', member_count: 3, pending_count: 2 },
		{ primary_evacuee_id: 'e2', contact_display: '', member_count: 1, pending_count: 0 }
	];

	it('describes each household to check in in English, keeping the contact name as data', () => {
		languageStore.setLanguage('en');

		const { body } = render(PhoneHouseholdPicker, { props: { candidates, onselect: noop } });

		expect(body).toContain('Several households use this number');
		expect(body).toContain('Choose your household');
		expect(body).toContain('3 members · 2 waiting to check in');
		expect(body).toContain('All checked in');
		expect(body).toContain('1 member');
		expect(body).toContain('Name not given');
		expect(body).toContain('สมชาย ใ***');
		expect(body.replaceAll('สมชาย ใ***', '')).not.toMatch(THAI);
	});

	it('describes each household to reprint in English', () => {
		languageStore.setLanguage('en');

		const { body } = render(PhoneHouseholdPicker, {
			props: { candidates, onselect: noop, mode: 'reprint' }
		});

		expect(body).toContain('3 members · 2 can print QR');
		expect(body).toContain('1 member · no QR to print yet');
		expect(body).toContain('aria-label="สมชาย ใ***, 3 members, 2 can print QR"');
	});

	it('keeps the Thai copy byte-identical in Thai', () => {
		const { body } = render(PhoneHouseholdPicker, { props: { candidates, onselect: noop } });

		expect(body).toContain('พบหลายครัวเรือนที่ใช้เบอร์นี้');
		expect(body).toContain('สมาชิก 3 คน · รอรายงานตัว 2 คน');
		expect(body).toContain('รายงานตัวครบแล้ว');
		expect(body).toContain('aria-label="สมชาย ใ***, สมาชิก 3 คน, รอรายงานตัว 2 คน"');
		expect(body).toContain('ไม่ระบุชื่อ');
	});
});
