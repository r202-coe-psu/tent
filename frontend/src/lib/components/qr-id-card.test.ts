import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import QrIdCard from './qr-id-card.svelte';

const checklist = ['เช็คอิน', 'คัดกรอง', 'ที่พัก'];

describe('QrIdCard', () => {
	it('renders the staff ID card with QR, name, phone and checklist', () => {
		const result = render(QrIdCard, {
			props: {
				id: 'qr-identity-card-01ABC',
				src: 'data:image/png;base64,abc',
				alt: 'QR',
				name: 'สักก์ธนัชญ์ ประดิษฐอุกฤษฎ์',
				phone: '0804497982',
				checklist
			}
		});

		expect(result.body).toContain('id="qr-identity-card-01ABC"');
		expect(result.body).toContain('qr-identity-card');
		expect(result.body).toContain('src="data:image/png;base64,abc"');
		expect(result.body).toContain('สักก์ธนัชญ์ ประดิษฐอุกฤษฎ์');
		expect(result.body).toContain('0804497982');
		for (const item of checklist) expect(result.body).toContain(item);
		expect(result.body.match(/aria-hidden="true"/g)).toHaveLength(3);
	});

	it('renders the thermal label without the staff card print-capture hook', () => {
		const result = render(QrIdCard, {
			props: {
				src: 'data:image/png;base64,abc',
				alt: 'QR',
				name: 'ทดสอบ หนึ่ง',
				phone: '0812345678',
				checklist,
				variant: 'label'
			}
		});

		expect(result.body).not.toContain('qr-identity-card');
		expect(result.body).toContain('size-(--qr-size)');
		expect(result.body).toContain('line-clamp-3');
	});

	it('omits the phone line when there is no phone', () => {
		const result = render(QrIdCard, {
			props: { src: 'data:image/png;base64,abc', alt: 'QR', name: 'ทดสอบ', phone: null, checklist }
		});

		expect(result.body).not.toContain('card-phone');
	});

	it('shows a placeholder until the QR is ready', () => {
		const screen = render(QrIdCard, {
			props: { src: null, alt: 'QR', name: 'ทดสอบ', checklist }
		});
		const label = render(QrIdCard, {
			props: { src: undefined, alt: 'QR', name: 'ทดสอบ', checklist, variant: 'label' }
		});

		expect(screen.body).not.toContain('<img');
		expect(screen.body).toContain('>...</div>');
		expect(label.body).toContain('>QR</div>');
	});

	it('escapes markup in the name', () => {
		const result = render(QrIdCard, {
			props: { src: null, alt: 'QR', name: '<script>alert(1)</script>', checklist }
		});

		expect(result.body).not.toContain('<script>alert(1)</script>');
	});
});
