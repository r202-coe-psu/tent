import { describe, expect, it, vi } from 'vitest';
import type { compressImage } from '$lib/utils/image-compress';
import { FOOTER_LOGO_IMAGE_MAX_BYTES, FOOTER_LOGO_TOO_LARGE_MESSAGE } from '../domain/footer-logo';
import { prepareFooterLogoUpload } from './footer-logo-upload';

const KB = 1024;

function fileOf(name: string, type: string, size: number): File {
	return new File([new Uint8Array(size)], name, { type });
}

function compressTo(type: string, size: number) {
	return vi.fn<typeof compressImage>(async (file) => ({
		full: new Blob([new Uint8Array(size)], { type }),
		thumbnail: new Blob(),
		width: 512,
		height: 128,
		originalSize: file.size,
		compressedSize: size,
		thumbnailSize: 0
	}));
}

describe('prepareFooterLogoUpload', () => {
	it('accepts a designer-sized logo by shrinking it to WebP under 512 KB', async () => {
		const picked = fileOf('psu-logo.png', 'image/png', 3 * 1024 * KB);
		const compress = compressTo('image/webp', 30 * KB);

		const upload = await prepareFooterLogoUpload(picked, compress);

		expect(upload).toMatchObject({ ok: true });
		if (!upload.ok) return;
		expect(upload.file.name).toBe('psu-logo.webp');
		expect(upload.file.type).toBe('image/webp');
		expect(upload.file.size).toBe(30 * KB);
		expect(compress).toHaveBeenCalledWith(picked, {
			maxPx: 512,
			quality: 0.85,
			mimeType: 'image/webp'
		});
	});

	it('names the file from the encoder output when the browser falls back to PNG', async () => {
		const picked = fileOf('logo.jpg', 'image/jpeg', 2 * 1024 * KB);

		const upload = await prepareFooterLogoUpload(picked, compressTo('image/png', 200 * KB));

		expect(upload.ok && upload.file.name).toBe('logo.png');
		expect(upload.ok && upload.file.type).toBe('image/png');
	});

	it('keeps an already-small original when re-encoding would not shrink it', async () => {
		const picked = fileOf('tiny.png', 'image/png', 8 * KB);

		const upload = await prepareFooterLogoUpload(picked, compressTo('image/webp', 12 * KB));

		expect(upload).toEqual({ ok: true, file: picked });
	});

	it('rejects when even the compressed image is over 512 KB', async () => {
		const picked = fileOf('huge.png', 'image/png', 8 * 1024 * KB);

		const upload = await prepareFooterLogoUpload(
			picked,
			compressTo('image/webp', FOOTER_LOGO_IMAGE_MAX_BYTES + 1)
		);

		expect(upload).toEqual({ ok: false, error: FOOTER_LOGO_TOO_LARGE_MESSAGE });
	});

	it('rejects an unsupported type without trying to compress it', async () => {
		const compress = compressTo('image/webp', KB);

		const upload = await prepareFooterLogoUpload(
			fileOf('logo.svg', 'image/svg+xml', 4 * KB),
			compress
		);

		expect(upload).toEqual({ ok: false, error: 'รองรับเฉพาะรูป png / jpeg / webp' });
		expect(compress).not.toHaveBeenCalled();
	});

	it('rejects a file the browser cannot decode as an image', async () => {
		const compress = vi.fn<typeof compressImage>().mockRejectedValue(new Error('Failed to load'));

		const upload = await prepareFooterLogoUpload(fileOf('fake.png', 'image/png', 4 * KB), compress);

		expect(upload).toEqual({ ok: false, error: 'ไม่สามารถอ่านไฟล์รูปภาพได้' });
	});
});
