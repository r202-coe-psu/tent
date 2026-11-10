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

	it('prints the QR caption lines under the QR when given', () => {
		const caption = ['สำหรับใช้ภายในศูนย์', '(For shelter use only)'];
		const body = render(QrIdCard, { props: { ...base, qrCaption: caption } }).body;

		for (const line of caption) expect(body.indexOf(line)).toBeGreaterThan(body.indexOf('<img'));
		expect(render(QrIdCard, { props: base }).body).not.toContain('label-qr-caption');
	});

	it('prints the emergency row after the zone row when given', () => {
		const body = render(QrIdCard, {
			props: {
				...base,
				zone: { label: 'Zone:', value: 'A3' },
				emergency: { label: 'ติดต่อฉุกเฉิน:', value: '0891234567' }
			}
		}).body;

		expect(body).toMatch(/>ติดต่อฉุกเฉิน:<\/span>.*>0891234567<\/span>/);
		expect(body.indexOf('0891234567')).toBeGreaterThan(body.indexOf('A3'));
		expect(body.indexOf('0891234567')).toBeLessThan(body.indexOf('เช็คอิน'));
		expect(render(QrIdCard, { props: base }).body).not.toContain('ติดต่อฉุกเฉิน');
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

	it('prints a red marker as an inverted band with a filled square and the level word', () => {
		const body = render(QrIdCard, { props: { ...base, marker: 'red' } }).body;

		expect(body).toContain('data-marker="red"');
		expect(body).toContain('aria-label="ระดับความเปราะบาง: แดง"');
		const tag = body.match(/<[^>]*data-marker="red"[^>]*>/)?.[0] ?? '';
		expect(tag).toContain('bg-black');
		expect(tag).toContain('text-white');
		expect(body).toContain('■');
		expect(body).toContain('แดง');
	});

	it('prints a yellow marker as a black-outlined block with a hollow triangle and the level word', () => {
		const body = render(QrIdCard, { props: { ...base, marker: 'yellow' } }).body;

		expect(body).toContain('data-marker="yellow"');
		expect(body).toContain('aria-label="ระดับความเปราะบาง: เหลือง"');
		const tag = body.match(/<[^>]*data-marker="yellow"[^>]*>/)?.[0] ?? '';
		expect(tag).toMatch(/border-\[[\d.]+mm\]/);
		expect(tag).toContain('border-black');
		expect(tag).not.toContain('bg-black');
		expect(body).toContain('△');
		expect(body).toContain('เหลือง');
		expect(body).not.toContain('■');
	});

	it('prints no marker when there is no level', () => {
		for (const marker of [null, undefined]) {
			const body = render(QrIdCard, { props: { ...base, marker } }).body;

			expect(body).not.toContain('data-marker');
			expect(body).not.toContain('ระดับความเปราะบาง');
			expect(body).not.toMatch(/[■△]/);
		}
	});

	it('keeps the marker in the text column, above the name and clear of the QR', () => {
		for (const marker of ['red', 'yellow'] as const) {
			const body = render(QrIdCard, { props: { ...base, marker } }).body;
			const at = body.indexOf('data-marker');

			expect(at).toBeGreaterThan(-1);
			expect(at).toBeLessThan(body.indexOf('ทดสอบ หนึ่ง'));
			expect(at).toBeLessThan(body.indexOf('<img'));
			expect(body).toContain('size-(--qr-size)');
		}
	});

	it('escapes markup in the name', () => {
		const result = render(QrIdCard, {
			props: { ...base, name: '<script>alert(1)</script>' }
		});

		expect(result.body).not.toContain('<script>alert(1)</script>');
	});
});
