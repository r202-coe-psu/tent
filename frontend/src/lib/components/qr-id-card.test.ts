import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import QrIdCard from './qr-id-card.svelte';

const checklist = ['เช็คอิน', 'คัดกรอง', 'ที่พัก'];
const base = { src: 'data:image/png;base64,abc', alt: 'QR', name: 'ทดสอบ หนึ่ง', checklist };

describe('QrIdCard', () => {
	it('renders the label with QR, name and checklist boxes', () => {
		const result = render(QrIdCard, { props: base });

		expect(result.body).toContain('src="data:image/png;base64,abc"');
		expect(result.body).toContain('size-(--qr-size)');
		expect(result.body).toContain('ทดสอบ หนึ่ง');
		expect(result.body).toContain('line-clamp-3');
		for (const item of checklist) expect(result.body).toContain(item);
		expect(result.body.match(/aria-hidden="true"/g)).toHaveLength(3);
	});

	it('stacks the checklist one item per row', () => {
		const result = render(QrIdCard, { props: base });

		expect(result.body).toMatch(/class="label-checklist[^"]*flex-col/);
	});

	it('ticks the first boxes, one per station passed', () => {
		const none = render(QrIdCard, { props: base });
		const two = render(QrIdCard, { props: { ...base, checkedCount: 2 } });

		expect(none.body).not.toContain('<polyline');
		expect(two.body.match(/<polyline/g)).toHaveLength(2);
		expect(two.body.indexOf('<polyline')).toBeLessThan(two.body.indexOf('เช็คอิน'));
		expect(two.body.lastIndexOf('<polyline')).toBeLessThan(two.body.indexOf('คัดกรอง'));
		expect(two.body.lastIndexOf('<polyline')).toBeGreaterThan(two.body.indexOf('เช็คอิน'));
	});

	it('prints the footer small under the checklist, left of the QR', () => {
		const result = render(QrIdCard, { props: { ...base, footer: 'shelter.psu.ac.th' } });
		const body = result.body;

		expect(body).toMatch(/text-\[7pt\][^>]*>shelter\.psu\.ac\.th</);
		expect(body.indexOf('shelter.psu.ac.th')).toBeGreaterThan(body.indexOf('ที่พัก'));
		expect(body.indexOf('shelter.psu.ac.th')).toBeLessThan(body.indexOf('<img'));
	});

	it('prints the assigned zone after its label', () => {
		const result = render(QrIdCard, {
			props: { ...base, zone: { label: 'Zone:', value: 'A3' } }
		});

		expect(result.body).toMatch(/>Zone:<\/span>.*>A3<\/span>/);
		expect(result.body).not.toContain('border-dotted');
	});

	it('leaves a blank dotted line to write the zone on when none is assigned', () => {
		const result = render(QrIdCard, {
			props: { ...base, zone: { label: 'Zone:', value: null } }
		});

		expect(result.body).toContain('Zone:');
		expect(result.body).toContain('border-dotted');
	});

	it('has no zone row unless asked for one', () => {
		const result = render(QrIdCard, { props: base });

		expect(result.body).not.toContain('Zone:');
	});

	it('shows a placeholder until the QR is ready', () => {
		const result = render(QrIdCard, { props: { ...base, src: undefined } });

		expect(result.body).not.toContain('<img');
		expect(result.body).toContain('>QR</div>');
	});

	it('escapes markup in the name', () => {
		const result = render(QrIdCard, {
			props: { ...base, name: '<script>alert(1)</script>' }
		});

		expect(result.body).not.toContain('<script>alert(1)</script>');
	});
});
