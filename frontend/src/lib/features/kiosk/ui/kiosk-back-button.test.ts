import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import KioskBackButton from './kiosk-back-button.svelte';

describe('KioskBackButton', () => {
	it('links to the given step with the default accessible name', () => {
		const { body } = render(KioskBackButton, { props: { href: '/kiosk?shelter_code=SH001' } });

		expect(body).toContain('href="/kiosk?shelter_code=SH001"');
		expect(body).toContain('aria-label="กลับหน้าเริ่มต้น"');
		expect(body).toContain('กลับ');
	});

	it('lets a step name a different destination', () => {
		const { body } = render(KioskBackButton, {
			props: { href: '/kiosk/phone', label: 'กลับไปกรอกเบอร์' }
		});

		expect(body).toContain('aria-label="กลับไปกรอกเบอร์"');
		expect(body).not.toContain('กลับหน้าเริ่มต้น');
	});

	it('carries the portrait touch-target size every step shares', () => {
		const { body } = render(KioskBackButton, { props: { href: '/kiosk' } });

		for (const token of [
			'min-h-11',
			'kiosk-portrait:min-h-16',
			'kiosk-portrait:px-5',
			'kiosk-portrait:text-xl'
		]) {
			expect(body).toContain(token);
		}
	});
});
