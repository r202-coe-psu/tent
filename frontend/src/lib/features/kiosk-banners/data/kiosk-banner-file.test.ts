import { describe, expect, it } from 'vitest';
import { KIOSK_BANNER_IMAGE_MAX_BYTES } from '../domain/kiosk-banner-image';
import { readBannerFile, validateBannerFile } from './kiosk-banner-file';

const fileOf = (bytes: number[] | number, type: string, name = 'banner'): File =>
	new File([typeof bytes === 'number' ? new Uint8Array(bytes) : new Uint8Array(bytes)], name, {
		type
	});

describe('validateBannerFile', () => {
	it.each(['image/png', 'image/jpeg', 'image/webp'])('accepts %s', (type) => {
		expect(validateBannerFile(fileOf(10, type))).toBeNull();
	});

	it('accepts a file exactly at the size limit', () => {
		expect(validateBannerFile(fileOf(KIOSK_BANNER_IMAGE_MAX_BYTES, 'image/png'))).toBeNull();
	});

	it('rejects unsupported types with a Thai message', () => {
		expect(validateBannerFile(fileOf(10, 'image/gif'))).toBe('รองรับเฉพาะรูป png / jpeg / webp');
		expect(validateBannerFile(fileOf(10, ''))).toBe('รองรับเฉพาะรูป png / jpeg / webp');
	});

	it('rejects files over the size limit', () => {
		expect(validateBannerFile(fileOf(KIOSK_BANNER_IMAGE_MAX_BYTES + 1, 'image/png'))).toBe(
			'รูปภาพต้องมีขนาดไม่เกิน 2 MB'
		);
	});

	it('rejects empty files', () => {
		expect(validateBannerFile(fileOf(0, 'image/png'))).toBe('ไม่พบข้อมูลรูปภาพ');
	});
});

describe('readBannerFile', () => {
	it('returns the content type and base64 body without a data-URL prefix', async () => {
		const result = await readBannerFile(fileOf([0x89, 0x50, 0x4e, 0x47], 'image/png'));
		expect(result).toEqual({ content_type: 'image/png', data_base64: 'iVBORw==' });
	});

	it('encodes larger files without truncation', async () => {
		const bytes = Array.from({ length: 100_000 }, (_, i) => i % 256);
		const { data_base64 } = await readBannerFile(fileOf(bytes, 'image/webp'));
		expect(Array.from(atob(data_base64), (c) => c.charCodeAt(0))).toEqual(bytes);
	});
});
