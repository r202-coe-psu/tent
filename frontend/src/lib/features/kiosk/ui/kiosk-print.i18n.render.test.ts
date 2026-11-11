import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { languageStore } from '$lib/stores/language.svelte';
import KioskPrintQrChooser from './kiosk-print-qr-chooser.svelte';
import KioskPrintStatus from './kiosk-print-status.svelte';

const THAI = /[฀-๿]/;

afterEach(() => languageStore.setLanguage('th'));

describe('KioskPrintStatus language', () => {
	it('tells the visitor in English that labels are printing and then done, with no Thai', () => {
		languageStore.setLanguage('en');

		const printing = render(KioskPrintStatus, { props: { phase: 'printing', count: 2 } }).body;
		const done = render(KioskPrintStatus, { props: { phase: 'done', count: 1 } }).body;

		expect(printing).toContain('Printing your QR Code');
		expect(printing).toContain('2 labels · please wait at the print slot');
		expect(done).toContain('Printing finished');
		expect(done).toContain('Take your 1 QR Code label at the print slot');
		expect(printing + done).not.toMatch(THAI);
	});

	it('keeps the Thai copy byte-identical in Thai', () => {
		const printing = render(KioskPrintStatus, { props: { phase: 'printing', count: 2 } }).body;
		const done = render(KioskPrintStatus, { props: { phase: 'done', count: 1 } }).body;

		expect(printing).toContain('กำลังพิมพ์ QR Code');
		expect(printing).toContain('2 ดวง · กรุณารอรับที่ช่องพิมพ์');
		expect(done).toContain('พิมพ์เสร็จแล้ว');
		expect(done).toContain('รับ QR Code 1 ดวงที่ช่องพิมพ์');
	});
});

describe('KioskPrintQrChooser language', () => {
	it('offers both targets in English, and the links keep the shelter context', () => {
		languageStore.setLanguage('en');

		const { body } = render(KioskPrintQrChooser, {
			props: { contextQuery: '?shelter_code=SH001' }
		});

		expect(body).toMatch(/<h1[^>]*>\s*Print QR\s*<\/h1>/);
		expect(body).toContain('Choose who the QR is for');
		expect(body).toContain('Shelter resident');
		expect(body).toContain('People registered to stay at the shelter');
		expect(body).toContain('Volunteer');
		expect(body).toContain('aria-label="Who to print a QR for"');
		expect(body).toContain(
			'aria-label="Volunteer · Print a volunteer QR card with a phone number"'
		);
		expect(body).toMatch(/<a[^>]*href="\/kiosk\/volunteer\?shelter_code=SH001"[^>]*>/);
		expect(body).not.toMatch(THAI);
	});
});
