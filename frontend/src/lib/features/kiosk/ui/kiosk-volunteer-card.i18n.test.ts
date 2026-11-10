import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { languageStore } from '$lib/stores/language.svelte';
import KioskVolunteerCard from './kiosk-volunteer-card.svelte';

const THAI = /[฀-๿]/;
const props = { contextQuery: '?shelter_code=SH001' as const };

describe('KioskVolunteerCard language', () => {
	afterEach(() => languageStore.setLanguage('th'));

	it('keeps the Thai phone step', () => {
		const { body, head } = render(KioskVolunteerCard, { props });

		expect(body).toContain('กรอกเบอร์โทรที่ลงทะเบียนเป็นจิตอาสา');
		expect(body).toContain('aria-label="เบอร์โทรศัพท์ที่กรอก"');
		expect(head).toContain('พิมพ์ QR จิตอาสา — SmartShelter Kiosk');
	});

	it('shows the phone step in English', () => {
		languageStore.setLanguage('en');
		const { body, head } = render(KioskVolunteerCard, { props });

		expect(body).toMatch(/<h1[^>]*>\s*Print volunteer QR\s*<\/h1>/);
		expect(body).toContain('Enter the phone number registered as a volunteer');
		expect(body).toContain('aria-label="Phone number entered"');
		expect(body).toContain('aria-label="Back to the QR options"');
		expect(body).toContain('Search');
		expect(head).toContain('Print volunteer QR — SmartShelter Kiosk');
		expect(body).not.toMatch(THAI);
		expect(head).not.toMatch(THAI);
	});
});
