import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import KioskReprint from './kiosk-reprint.svelte';

describe('KioskReprint', () => {
	it('opens on the phone step titled พิมพ์ QR with a way back to the print-QR chooser', () => {
		const result = render(KioskReprint, { props: { contextQuery: '?shelter_code=SH001' } });

		expect(result.body).toMatch(/<h1[^>]*id="reprint-phone-title"[^>]*>\s*พิมพ์ QR\s*<\/h1>/);
		expect(result.body).toContain('กรอกเบอร์โทรที่ลงทะเบียนไว้');
		expect(result.body).toContain('href="/kiosk/print-qr?shelter_code=SH001"');
		expect(result.body).not.toContain('กรอกเลขบัตรประชาชน 4 ตัวท้าย');
	});
});
