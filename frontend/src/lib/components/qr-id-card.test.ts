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

	it('prints a red marker as plain black text: a filled square, the level word and its meaning', () => {
		const body = render(QrIdCard, { props: { ...base, marker: 'red' } }).body;

		expect(body).toContain('data-marker="red"');
		expect(body).toContain('aria-label="ระดับความเปราะบาง: แดง · ดูแลเร่งด่วน"');
		const tag = body.match(/<[^>]*data-marker="red"[^>]*>/)?.[0] ?? '';
		expect(tag).not.toContain('bg-black');
		expect(tag).not.toContain('text-white');
		expect(tag).not.toContain('border');
		expect(body).toContain('■');
		expect(body).toContain('แดง · ดูแลเร่งด่วน');
		expect(body).not.toContain('△');
	});

	it('prints a yellow marker as plain black text: a hollow triangle, the level word and its meaning', () => {
		const body = render(QrIdCard, { props: { ...base, marker: 'yellow' } }).body;

		expect(body).toContain('data-marker="yellow"');
		expect(body).toContain('aria-label="ระดับความเปราะบาง: เหลือง · ดูแลพิเศษ"');
		const tag = body.match(/<[^>]*data-marker="yellow"[^>]*>/)?.[0] ?? '';
		expect(tag).not.toContain('border');
		expect(tag).not.toContain('bg-black');
		expect(body).toContain('△');
		expect(body).toContain('เหลือง · ดูแลพิเศษ');
		expect(body).not.toContain('■');
	});

	it.each([
		['red', '■'],
		['yellow', '△']
	] as const)('raises the %s glyph 1px above the words', (marker, glyph) => {
		const body = render(QrIdCard, { props: { ...base, marker } }).body;

		expect(body).toMatch(new RegExp(`<span class="[^"]*-top-px[^"]*">${glyph}</span>`));
		const words = body.match(/<span>([^<]*ดูแล[^<]*)<\/span>/)?.[0] ?? '';
		expect(words).not.toContain('top-px');
	});

	it.each(['red', 'yellow'] as const)(
		'prints the %s marker in the emergency row size (9 pt) rather than the old 12 pt bold',
		(marker) => {
			const body = render(QrIdCard, { props: { ...base, marker } }).body;
			const tag = body.match(new RegExp(`<[^>]*data-marker="${marker}"[^>]*>`))?.[0] ?? '';

			expect(tag).toContain('text-[9pt]');
			expect(tag).not.toContain('text-[12pt]');
			expect(tag).not.toContain('font-bold');
		}
	);

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

	describe('level band at the left edge', () => {
		const bandTag = (body: string, marker: string) =>
			body.match(new RegExp(`<div[^>]*data-marker-band="${marker}"[^>]*>`))?.[0] ?? '';
		const bandInner = (body: string, marker: string) => {
			const tag = bandTag(body, marker);
			const from = body.indexOf(tag) + tag.length;
			return body.slice(from, body.indexOf('</div>', from));
		};

		it('prints yellow as a 4 mm band of two 0.5 mm rails with diagonal stripes, aria-hidden', () => {
			const tag = bandTag(
				render(QrIdCard, { props: { ...base, marker: 'yellow' } }).body,
				'yellow'
			);

			expect(tag).toContain('aria-hidden="true"');
			expect(tag).toContain('w-[4mm]');
			expect(tag).toContain('border-x-[0.5mm]');
			expect(tag).toContain('border-black');
			expect(tag).toMatch(/background-image: repeating-linear-gradient\(135deg/);
			expect(tag).not.toContain('bg-black');
		});

		it('prints red as the same 4 mm band filled solid black, without stripes', () => {
			const tag = bandTag(render(QrIdCard, { props: { ...base, marker: 'red' } }).body, 'red');

			expect(tag).toContain('aria-hidden="true"');
			expect(tag).toContain('w-[4mm]');
			expect(tag).toContain('bg-black');
			expect(tag).not.toContain('repeating-linear-gradient');
		});

		it.each(['red', 'yellow'] as const)(
			'puts the %s band first in the row, 2 mm clear of the text, unshrinkable, printing in colour',
			(marker) => {
				const body = render(QrIdCard, { props: { ...base, marker } }).body;
				const tag = bandTag(body, marker);

				expect(body.indexOf(tag)).toBeLessThan(body.indexOf('data-marker='));
				expect(body.indexOf(tag)).toBeLessThan(body.indexOf('<img'));
				expect(tag).toContain('mr-[2mm]');
				expect(tag).toContain('shrink-0');
				expect(tag).toContain('[print-color-adjust:exact]');
				expect(tag).not.toContain('absolute');
				expect(body).toContain('size-(--qr-size)');
			}
		);

		it('prints no words in the band', () => {
			for (const marker of ['red', 'yellow'] as const) {
				const body = render(QrIdCard, { props: { ...base, marker } }).body;

				expect(bandTag(body, marker)).not.toBe('');
				expect(
					bandInner(body, marker)
						.replace(/<[^>]*>/g, '')
						.trim()
				).toBe('');
			}
		});

		it('keeps the level words only in the marker row', () => {
			const red = render(QrIdCard, { props: { ...base, marker: 'red' } }).body;
			const yellow = render(QrIdCard, { props: { ...base, marker: 'yellow' } }).body;

			expect(red.match(/ดูแลเร่งด่วน/g)).toHaveLength(2);
			expect(yellow.match(/ดูแลพิเศษ/g)).toHaveLength(2);
		});

		it('prints no band when there is no level', () => {
			for (const marker of [null, undefined]) {
				const body = render(QrIdCard, { props: { ...base, marker } }).body;

				expect(body).not.toContain('data-marker-band');
				expect(body).not.toContain('bg-black');
				expect(body).not.toContain('ดูแลเร่งด่วน');
				expect(body).not.toContain('ดูแลพิเศษ');
			}
		});
	});

	it('prints the name at 15 pt, bold, clamped to three lines', () => {
		const body = render(QrIdCard, { props: base }).body;
		const tag = body.match(/<p[^>]*>ทดสอบ หนึ่ง<\/p>/)?.[0] ?? '';

		expect(tag).toContain('text-[12pt]');
		expect(tag).not.toContain('text-[16pt]');
		expect(tag).toContain('font-bold');
		expect(tag).toContain('line-clamp-3');
		expect(tag).toContain('leading-[1.3]');
	});

	it('escapes markup in the name', () => {
		const result = render(QrIdCard, {
			props: { ...base, name: '<script>alert(1)</script>' }
		});

		expect(result.body).not.toContain('<script>alert(1)</script>');
	});
});
