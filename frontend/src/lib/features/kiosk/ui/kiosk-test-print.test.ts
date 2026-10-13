import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import KioskTestPrint from './kiosk-test-print.svelte';

describe('KioskTestPrint', () => {
	it('shows only the small printer button; no PIN panel and no label until staff ask', () => {
		const { body } = render(KioskTestPrint);

		expect(body).toContain('aria-label="ทดสอบการพิมพ์"');
		expect(body).toContain('data-testid="kiosk-test-print-button"');
		expect(body).not.toContain('kiosk-staff-pin');
		expect(body).not.toContain('KIOSK-TEST-PRINT');
	});
});
