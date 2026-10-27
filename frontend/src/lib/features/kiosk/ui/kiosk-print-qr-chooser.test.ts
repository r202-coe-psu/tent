import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import KioskPrintQrChooser from './kiosk-print-qr-chooser.svelte';

describe('KioskPrintQrChooser', () => {
	it('offers evacuee and volunteer printing, keeping the display context, with a way back home', () => {
		const result = render(KioskPrintQrChooser, { props: { contextQuery: '?shelter_code=SH001' } });

		expect(result.body).toMatch(/<h1[^>]*>\s*พิมพ์ QR\s*<\/h1>/);
		expect(result.body).toMatch(/<a[^>]*href="\/kiosk\/reprint\?shelter_code=SH001"[^>]*>/);
		expect(result.body).toContain('ผู้พักพิง');
		expect(result.body).toContain('ผู้ที่ลงทะเบียนเข้าพักในศูนย์');
		expect(result.body).toMatch(/<a[^>]*href="\/kiosk\/volunteer\?shelter_code=SH001"[^>]*>/);
		expect(result.body).toContain('จิตอาสา');
		expect(result.body).toContain('พิมพ์บัตร QR จิตอาสาด้วยเบอร์โทร');
		expect(result.body).toContain('href="/kiosk?shelter_code=SH001"');
	});
});
