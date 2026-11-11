import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import KioskLabelCard from './kiosk-label-card.svelte';

const label = { qrSrc: 'data:image/png;base64,abc', qrSizeMm: 20, name: 'ทดสอบ หนึ่ง' };

describe('KioskLabelCard vulnerability marker (#1301)', () => {
	it('shows the red marker when the label carries it', () => {
		const body = render(KioskLabelCard, { props: { label: { ...label, marker: 'red' } } }).body;
		expect(body).toContain('data-marker="red"');
	});

	it('shows the yellow marker when the label carries it', () => {
		const body = render(KioskLabelCard, { props: { label: { ...label, marker: 'yellow' } } }).body;
		expect(body).toContain('data-marker="yellow"');
	});

	it('shows no marker row for a null or missing marker', () => {
		for (const marker of [null, undefined]) {
			const body = render(KioskLabelCard, { props: { label: { ...label, marker } } }).body;
			expect(body).not.toContain('data-marker');
		}
	});
});

describe('KioskLabelCard QR size beside the level bars', () => {
	const unsized = { ...label, qrSizeMm: undefined };

	it('falls back to the full QR box without a marker', () => {
		const body = render(KioskLabelCard, { props: { label: unsized } }).body;
		expect(body).toContain('--qr-size: 34.75mm');
	});

	it.each([
		['red', '28.75mm'],
		['yellow', '28.75mm']
	] as const)('falls back to the box the %s band leaves', (marker, size) => {
		const body = render(KioskLabelCard, { props: { label: { ...unsized, marker } } }).body;
		expect(body).toContain(`--qr-size: ${size}`);
	});

	it('uses the prepared QR size when the label carries one', () => {
		const body = render(KioskLabelCard, { props: { label: { ...label, marker: 'red' } } }).body;
		expect(body).toContain('--qr-size: 20mm');
	});
});
