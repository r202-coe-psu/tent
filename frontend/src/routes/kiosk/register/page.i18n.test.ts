import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { languageStore } from '$lib/stores/language.svelte';
import { walkInSession } from '$lib/features/kiosk';
import ConsentPage from './consent/+page.svelte';
import { KIOSK_REGISTER_CONSENT_I18N } from './consent/consent-page.i18n';
import DonePage from './done/+page.svelte';
import { KIOSK_REGISTER_DONE_I18N } from './done/done-page.i18n';
import PhonePage from './phone/+page.svelte';
import { KIOSK_REGISTER_PHONE_PAGE_I18N } from './phone/phone-page.i18n';

vi.mock('$app/state', () => ({ page: { url: new URL('http://kiosk.test/kiosk/register') } }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const THAI = /[฀-๿]/;

const registration: NonNullable<typeof walkInSession.registration> = {
	evacuee_id: 'EV1',
	qr_payload: 'qr',
	label: { name: 'สมชาย ใจดี', phone: null },
	consent_ref: 'CR-0001',
	consent_mode: 'full'
};

beforeEach(() => walkInSession.clear());
afterEach(() => {
	languageStore.setLanguage('th');
	walkInSession.clear();
});

describe('walk-in consent page language', () => {
	it('names the consent step in English, with no Thai in the page', () => {
		languageStore.setLanguage('en');

		const { body, head } = render(ConsentPage);

		expect(head).toContain('Consent to register — SmartShelter Kiosk');
		expect(body).toContain('Step 2 of 5 · Consent');
		expect(body).not.toMatch(THAI);
	});

	it('keeps the Thai title and step byte-identical in Thai', () => {
		const { body, head } = render(ConsentPage);

		expect(head).toContain('ยินยอมลงทะเบียน — SmartShelter Kiosk');
		expect(body).toContain('ขั้น 2 จาก 5 · ยินยอม');
	});
});

describe('walk-in phone page language', () => {
	it('names the phone step in English, with no Thai in the page', () => {
		languageStore.setLanguage('en');

		const { body, head } = render(PhonePage);

		expect(head).toContain('Phone number — SmartShelter Kiosk');
		expect(body).toContain('Step 4 of 5 · Phone');
		expect(body).not.toMatch(THAI);
	});

	it('keeps the Thai title and step byte-identical in Thai', () => {
		const { body, head } = render(PhonePage);

		expect(head).toContain('เบอร์โทรศัพท์ — SmartShelter Kiosk');
		expect(body).toContain('ขั้น 4 จาก 5 · เบอร์โทร');
	});
});

describe('walk-in done page language', () => {
	it('tells a card walk-in in English what to take and where to go, with no Thai', () => {
		languageStore.setLanguage('en');
		walkInSession.registration = registration;

		const { body, head } = render(DonePage);

		expect(head).toContain('Registration complete — SmartShelter Kiosk');
		expect(body).toContain('Registration complete');
		expect(body).toContain(
			'Please take your card out of the reader, take your QR Code, then go to the screening point'
		);
		expect(body).toContain('Consent reference:');
		expect(body).toContain('CR-0001');
		expect(body).toContain('Print again');
		expect(body).toContain('Back to home');
		// The label sheet after the panel is the printout, which stays Thai.
		expect(body.slice(0, body.indexOf('kiosk-print-area'))).not.toMatch(THAI);
	});

	it('asks to contact staff in English when nothing is left to print', () => {
		languageStore.setLanguage('en');

		const { body } = render(DonePage);

		expect(body).toContain('Please take your card out of the reader');
		expect(body).toContain('Please contact staff to print your QR Code');
	});

	it('keeps the Thai copy byte-identical in Thai', () => {
		walkInSession.registration = registration;

		const { body, head } = render(DonePage);

		expect(head).toContain('ลงทะเบียนสำเร็จ — SmartShelter Kiosk');
		expect(body).toContain('กรุณานำบัตรออกจากเครื่อง รับ QR Code แล้วไปที่จุดคัดกรอง');
		expect(body).toContain('เลขอ้างอิงความยินยอม:');
		expect(body).toContain('พิมพ์อีกครั้ง');
		expect(body).toContain('กลับหน้าแรก');
	});
});

describe.each([
	['consent page', KIOSK_REGISTER_CONSENT_I18N],
	['phone page', KIOSK_REGISTER_PHONE_PAGE_I18N],
	['done page', KIOSK_REGISTER_DONE_I18N]
])('%s dictionary', (_name, dictionary) => {
	it('has the same keys in both languages and no Thai in English', () => {
		const english = Object.entries(dictionary.en).map(([key, value]) => [
			key,
			typeof value === 'function' ? (value as (arg: string) => string)('x') : value
		]);

		expect(Object.keys(dictionary.en).sort()).toEqual(Object.keys(dictionary.th).sort());
		expect(english.filter(([, text]) => THAI.test(String(text)))).toEqual([]);
	});
});
