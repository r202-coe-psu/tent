import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import KioskLanguagePicker from './kiosk-language-picker.svelte';

describe('KioskLanguagePicker', () => {
	const { body } = render(KioskLanguagePicker, { props: { contextQuery: '' } });

	it('shows the heading in both languages at once', () => {
		expect(body).toContain('เลือกภาษา');
		expect(body).toContain('Choose your language');
	});

	it('offers a Thai and an English button, each with its flag', () => {
		expect(body).toContain('ภาษาไทย');
		expect(body).toContain('แตะเพื่อเริ่มลงทะเบียน');
		expect(body).toContain('English');
		expect(body).toContain('Tap to start registration');
		expect(body).toContain('aria-label="Thai flag"');
		expect(body).toContain('aria-label="UK flag"');
	});

	it('tells people without a Thai ID where to get help, in both languages', () => {
		expect(body).toContain(
			'ไม่มีบัตรประชาชนไทย หรือต้องการความช่วยเหลือ? ติดต่อเจ้าหน้าที่ Station 1'
		);
		expect(body).toContain('No Thai ID or need help? Please go to staff at Station 1');
	});
});
