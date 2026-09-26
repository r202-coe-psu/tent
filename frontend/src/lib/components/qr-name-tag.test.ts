import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import QrNameTag from './qr-name-tag.svelte';

describe('QrNameTag', () => {
	it('renders a label QR, name, and shelter detail without a pending state', () => {
		const result = render(QrNameTag, {
			props: {
				src: 'data:image/png;base64,abc',
				alt: 'Personal QR',
				caption: 'ชื่อ',
				name: 'ทดสอบ หนึ่ง',
				detail: 'ศูนย์ S01',
				variant: 'label'
			}
		});

		expect(result.body).toContain('<img');
		expect(result.body).toContain('src="data:image/png;base64,abc"');
		expect(result.body).toContain('ทดสอบ หนึ่ง');
		expect(result.body).toContain('ศูนย์ S01');
		expect(result.body).toContain('line-clamp-2');
		expect(result.body).not.toContain('animate-pulse');
	});

	it('renders a QR placeholder when the label source is empty', () => {
		const result = render(QrNameTag, {
			props: { src: undefined, alt: 'QR', caption: 'ชื่อ', name: 'ทดสอบ', variant: 'label' }
		});

		expect(result.body).not.toContain('<img');
		expect(result.body).toContain('>QR</div>');
		expect(result.body).toContain('border-black');
	});

	it('keeps the screen placeholder while a QR promise is pending', () => {
		const pendingQr = new Promise<string>(() => {});
		const result = render(QrNameTag, {
			props: { src: pendingQr, alt: 'QR', caption: 'ชื่อผู้จอง', name: 'ทดสอบ' }
		});

		expect(result.body).toContain('animate-pulse');
		expect(result.body).not.toContain('<img');
	});

	it('omits detail when it is not supplied', () => {
		const result = render(QrNameTag, {
			props: { src: 'data:image/png;base64,abc', alt: 'QR', caption: 'ชื่อ', name: 'ทดสอบ' }
		});

		expect(result.body.match(/<p\b/g)).toHaveLength(2);
	});

	it('escapes markup in the name', () => {
		const result = render(QrNameTag, {
			props: {
				src: 'data:image/png;base64,abc',
				alt: 'QR',
				caption: 'ชื่อ',
				name: '<script>alert(1)</script>'
			}
		});

		expect(result.body).toContain('&lt;script>alert(1)&lt;/script>');
		expect(result.body).not.toContain('<script>alert(1)</script>');
	});
});
