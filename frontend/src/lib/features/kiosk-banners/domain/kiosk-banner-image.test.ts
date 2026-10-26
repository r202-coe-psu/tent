import { describe, expect, it } from 'vitest';
import { decodeBannerImage, detectBannerImageMime } from './kiosk-banner-image';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

describe('detectBannerImageMime', () => {
	it('detects png from magic bytes', () => {
		expect(detectBannerImageMime(new Uint8Array([...PNG, 0, 0]))).toBe('image/png');
	});

	it('detects jpeg from magic bytes', () => {
		expect(detectBannerImageMime(new Uint8Array(JPEG))).toBe('image/jpeg');
	});

	it('detects webp from RIFF....WEBP header', () => {
		expect(detectBannerImageMime(new Uint8Array(WEBP))).toBe('image/webp');
	});

	it('returns null for RIFF container that is not webp', () => {
		const wav = [0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45];
		expect(detectBannerImageMime(new Uint8Array(wav))).toBeNull();
	});

	it('returns null for gif and text bytes', () => {
		const gif = new TextEncoder().encode('GIF89a\x01\x00');
		expect(detectBannerImageMime(gif)).toBeNull();
		expect(detectBannerImageMime(new TextEncoder().encode('hello world!'))).toBeNull();
		expect(detectBannerImageMime(new Uint8Array())).toBeNull();
	});
});

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

describe('decodeBannerImage', () => {
	it('takes the mime from magic bytes even when content_type lies', () => {
		const bytes = new Uint8Array([...PNG, 1, 2, 3, 4]);
		const result = decodeBannerImage({ content_type: 'image/jpeg', data_base64: toBase64(bytes) });
		expect(result).toEqual({ ok: true, bytes, contentType: 'image/png' });
	});

	it('accepts jpeg and webp', () => {
		const jpeg = decodeBannerImage({
			content_type: 'image/jpeg',
			data_base64: toBase64(new Uint8Array(JPEG))
		});
		const webp = decodeBannerImage({
			content_type: 'image/webp',
			data_base64: toBase64(new Uint8Array(WEBP))
		});
		expect(jpeg).toMatchObject({ ok: true, contentType: 'image/jpeg' });
		expect(webp).toMatchObject({ ok: true, contentType: 'image/webp' });
	});

	it('rejects non-canonical base64', () => {
		const good = toBase64(new Uint8Array([...PNG, 1, 2, 3]));
		const unpadded = good.replace(/=+$/, '');
		expect(unpadded).not.toBe(good);
		for (const data_base64 of [
			'not base64!!',
			unpadded,
			`${good}\n`,
			'data:image/png;base64,AAAA'
		]) {
			expect(decodeBannerImage({ content_type: 'image/png', data_base64 })).toEqual({
				ok: false,
				reason: 'invalid_base64'
			});
		}
	});

	it('rejects images over 2 MB but accepts exactly 2 MB', () => {
		const withSize = (size: number) => {
			const bytes = new Uint8Array(size);
			bytes.set(PNG);
			return toBase64(bytes);
		};
		expect(
			decodeBannerImage({ content_type: 'image/png', data_base64: withSize(2 * 1024 * 1024 + 1) })
		).toEqual({ ok: false, reason: 'too_large' });
		expect(
			decodeBannerImage({ content_type: 'image/png', data_base64: withSize(2 * 1024 * 1024) })
		).toMatchObject({ ok: true, contentType: 'image/png' });
	});

	it('applies a caller-supplied cap instead of the banner default (CR-184 footer logos)', () => {
		const withSize = (size: number) => {
			const bytes = new Uint8Array(size);
			bytes.set(PNG);
			return toBase64(bytes);
		};
		const cap = 512 * 1024;
		expect(
			decodeBannerImage({ content_type: 'image/png', data_base64: withSize(cap + 1) }, cap)
		).toEqual({ ok: false, reason: 'too_large' });
		expect(
			decodeBannerImage({ content_type: 'image/png', data_base64: withSize(cap) }, cap)
		).toMatchObject({ ok: true, contentType: 'image/png' });
	});

	it('rejects text bytes labelled png and gif as unsupported_type', () => {
		const text = toBase64(new TextEncoder().encode('this is not an image'));
		const gif = toBase64(new TextEncoder().encode('GIF89a\x01\x00\x01\x00'));
		expect(decodeBannerImage({ content_type: 'image/png', data_base64: text })).toEqual({
			ok: false,
			reason: 'unsupported_type'
		});
		expect(decodeBannerImage({ content_type: 'image/gif', data_base64: gif })).toEqual({
			ok: false,
			reason: 'unsupported_type'
		});
	});

	it('rejects an empty payload', () => {
		expect(decodeBannerImage({ content_type: 'image/png', data_base64: '' })).toEqual({
			ok: false,
			reason: 'empty'
		});
	});
});
