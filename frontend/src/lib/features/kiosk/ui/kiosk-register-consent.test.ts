import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import KioskRegisterConsent from './kiosk-register-consent.svelte';

describe('KioskRegisterConsent', () => {
	it('lists card data read for registration and when to remove the card', () => {
		const result = render(KioskRegisterConsent, {
			props: { onconsent: vi.fn(), oncancel: vi.fn() }
		});

		expect(result.body).toContain('ชื่อและนามสกุล');
		expect(result.body).toContain('เลขบัตรประชาชน');
		expect(result.body).toContain('เพศ');
		expect(result.body).toContain('วันเกิด');
		expect(result.body).toContain('ที่อยู่');
		expect(result.body).toContain('รูปถ่าย');
		expect(result.body).toContain('ลงทะเบียนสำเร็จแล้วจึงนำบัตรออก');
	});
});
