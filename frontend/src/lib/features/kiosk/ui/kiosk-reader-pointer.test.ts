import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import KioskReaderPointer from './kiosk-reader-pointer.svelte';

describe('KioskReaderPointer', () => {
	it('pins to the bottom-left corner for the card slot', () => {
		const { body } = render(KioskReaderPointer, {
			props: { side: 'left', label: 'ช่องเสียบบัตร' }
		});

		expect(body).toContain('data-reader-side="left"');
		expect(body).toContain('left-14');
		expect(body).toContain('ช่องเสียบบัตร');
	});

	it('pins to the bottom-right corner for the QR reader', () => {
		const { body } = render(KioskReaderPointer, {
			props: { side: 'right', label: 'เครื่องสแกน QR' }
		});

		expect(body).toContain('data-reader-side="right"');
		expect(body).toContain('right-14');
	});

	it('hides the arrow from assistive tech while keeping the label readable', () => {
		const { body } = render(KioskReaderPointer, {
			props: { side: 'left', label: 'ช่องเสียบบัตร' }
		});

		expect(body).toContain('aria-hidden="true"');
		expect(body).toContain('ช่องเสียบบัตร');
	});
});
