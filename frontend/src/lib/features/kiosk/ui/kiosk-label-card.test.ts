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
