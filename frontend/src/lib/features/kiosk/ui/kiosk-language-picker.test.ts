import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import KioskLanguagePicker from './kiosk-language-picker.svelte';

describe('KioskLanguagePicker', () => {
	const { body } = render(KioskLanguagePicker, { props: { contextQuery: '' } });

	it('shows the heading in both languages at once', () => {
		expect(body).toContain('เลือกภาษา');
		expect(body).toContain('Choose your language');
	});

	it('offers a Thai and an English button, each with a decorative flag', () => {
		expect(body).toContain('ภาษาไทย');
		expect(body).toContain('แตะเพื่อเริ่ม');
		expect(body).toContain('English');
		expect(body).toContain('Tap to start');
		// The button text already names the language; the flag must not repeat it.
		expect(body).not.toContain('aria-label="Thai flag"');
		expect(body).not.toContain('aria-label="UK flag"');
	});

	it('tells people without a Thai ID where to get help, in both languages', () => {
		expect(body).toContain('ไม่มีบัตรประชาชนไทย หรือต้องการความช่วยเหลือ? ติดต่อเจ้าหน้าที่');
		expect(body).toContain('No Thai ID or need help? Please ask a staff member');
	});
});
