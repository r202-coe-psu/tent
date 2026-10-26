import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import KioskVolunteerCard from './kiosk-volunteer-card.svelte';

describe('KioskVolunteerCard', () => {
	it('starts on the phone step with a way back to the QR chooser and nothing to print yet', () => {
		const { body } = render(KioskVolunteerCard, {
			props: { contextQuery: '?shelter_code=SH001' }
		});

		expect(body).toMatch(/<h1[^>]*>\s*พิมพ์ QR จิตอาสา\s*<\/h1>/);
		expect(body).toContain('กรอกเบอร์โทรที่ลงทะเบียนเป็นจิตอาสา');
		expect(body).toContain('href="/kiosk/print-qr?shelter_code=SH001"');
		expect(body).not.toContain('ไม่ใช่ฉัน');
		expect(body).not.toContain('พิมพ์ QR</button>');
	});
});
