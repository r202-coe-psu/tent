import { describe, expect, it, vi } from 'vitest';
import type { compressImage } from '$lib/utils/image-compress';
import { prepareTemplateLogo } from './kiosk-banner-template-logo';

const KB = 1024;

function fileOf(name: string, type: string, size: number): File {
	return new File([new Uint8Array(size)], name, { type });
}

function compressTo(type: string, size: number) {
	return vi.fn<typeof compressImage>(async (file) => ({
		full: new Blob([new Uint8Array(size)], { type }),
		thumbnail: new Blob(),
		width: 1024,
		height: 512,
		originalSize: file.size,
		compressedSize: size,
		thumbnailSize: 0
	}));
}

describe('prepareTemplateLogo', () => {
	it('shrinks a large photo to WebP under 512 KB', async () => {
		const picked = fileOf('poster.jpg', 'image/jpeg', 5 * 1024 * KB);
		const compress = compressTo('image/webp', 180 * KB);

		const logo = await prepareTemplateLogo(picked, compress);

		expect(logo).toMatchObject({ ok: true });
		if (!logo.ok) return;
		expect(logo.file.name).toBe('poster.webp');
		expect(logo.file.type).toBe('image/webp');
		expect(logo.file.size).toBe(180 * KB);
		expect(compress).toHaveBeenCalledWith(picked, {
			maxPx: 1024,
			quality: 0.85,
			mimeType: 'image/webp'
		});
	});

	it('keeps an already-small original when re-encoding would not shrink it', async () => {
		const picked = fileOf('logo.png', 'image/png', 20 * KB);

		const logo = await prepareTemplateLogo(picked, compressTo('image/webp', 40 * KB));

		expect(logo).toEqual({ ok: true, file: picked });
	});

	it('rejects when even the shrunk image is over 512 KB', async () => {
		const picked = fileOf('noise.png', 'image/png', 3 * 1024 * KB);

		const logo = await prepareTemplateLogo(picked, compressTo('image/webp', 600 * KB));

		expect(logo).toEqual({ ok: false, error: 'รูป/โลโก้ต้องมีขนาดไม่เกิน 512 KB' });
	});

	it('rejects an unsupported type or an empty file without compressing', async () => {
		const compress = compressTo('image/webp', 10 * KB);

		expect(await prepareTemplateLogo(fileOf('a.gif', 'image/gif', KB), compress)).toEqual({
			ok: false,
			error: 'รองรับเฉพาะรูป png / jpeg / webp'
		});
		expect(await prepareTemplateLogo(fileOf('a.png', 'image/png', 0), compress)).toEqual({
			ok: false,
			error: 'ไม่พบข้อมูลรูปภาพ'
		});
		expect(compress).not.toHaveBeenCalled();
	});

	it('reports a file the browser cannot decode', async () => {
		const compress = vi.fn<typeof compressImage>(async () => {
			throw new Error('decode failed');
		});

		expect(await prepareTemplateLogo(fileOf('a.png', 'image/png', KB), compress)).toEqual({
			ok: false,
			error: 'ไม่สามารถอ่านไฟล์รูปภาพได้'
		});
	});
});
