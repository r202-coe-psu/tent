import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import KioskQrScanScene from './kiosk-qr-scan-scene.svelte';

describe('KioskQrScanScene', () => {
	it('is decorative: the instruction lives in the page text, not in the picture', () => {
		const { body } = render(KioskQrScanScene);

		expect(body).toContain('aria-hidden="true"');
		expect(body).not.toContain('role="img"');
	});

	it('sizes the QR per screen profile from a single width variable', () => {
		const { body } = render(KioskQrScanScene);

		expect(body).toContain('[--w:9rem]');
		expect(body).toContain('kiosk-portrait:[--w:17rem]');
	});

	it('draws the same QR on every render', () => {
		expect(render(KioskQrScanScene).body).toBe(render(KioskQrScanScene).body);
	});
});
