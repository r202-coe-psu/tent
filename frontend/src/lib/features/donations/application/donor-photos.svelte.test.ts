import { describe, expect, it, vi } from 'vitest';
import type { CompressResult } from '$lib/utils/image-compress';
import { DonorPhotos, type DonorPhotoDeps, type DonorPhotoRefusal } from './donor-photos.svelte';

const MB = 1024 * 1024;

function file(name: string, size = 3 * MB): File {
	const f = new File(['x'], name, { type: 'image/jpeg' });
	Object.defineProperty(f, 'size', { value: size });
	return f;
}

/** Compression that yields `bytes` (full + thumb) per file, named by the file. */
function deps(bytesOf: (f: File) => number, over: Partial<DonorPhotoDeps> = {}): DonorPhotoDeps {
	let n = 0;
	return {
		compress: vi.fn(async (f: File) => ({
			compressed: { thumbnail: new Blob([f.name]) } as unknown as CompressResult,
			bytes: bytesOf(f)
		})),
		upload: vi.fn(async () => `image:01K8PHXTX${String(++n).padStart(17, '0')}`),
		previewUrl: vi.fn(() => 'blob:preview'),
		revokeUrl: vi.fn(),
		...over
	};
}

async function pick(photos: DonorPhotos, files: File[]) {
	const refused: Array<[DonorPhotoRefusal, string]> = [];
	await photos.add(files, 'SH001', (reason, f) => refused.push([reason, f.name]));
	return refused;
}

describe('DonorPhotos (CR-175 donor photos)', () => {
	it('uploads each picked photo and hands its id to the booking', async () => {
		const d = deps(() => 300_000);
		const photos = new DonorPhotos(d);

		expect(await pick(photos, [file('a.jpg'), file('b.jpg')])).toEqual([]);

		expect(photos.photoIds).toHaveLength(2);
		expect(photos.budget).toEqual({ count: 2, bytes: 600_000, full: false });
		expect(photos.busy).toBe(false);
		expect(d.upload).toHaveBeenCalledWith('SH001', expect.any(File), expect.anything());
	});

	it('refuses a 25 MB original before compressing it (FR-4, AC-3)', async () => {
		const d = deps(() => 300_000);
		const photos = new DonorPhotos(d);

		expect(await pick(photos, [file('huge.jpg', 25 * MB)])).toEqual([
			['original_too_large', 'huge.jpg']
		]);
		expect(d.compress).not.toHaveBeenCalled();
		expect(photos.items).toEqual([]);
	});

	it('takes an original of exactly 20 MB', async () => {
		const photos = new DonorPhotos(deps(() => 300_000));
		expect(await pick(photos, [file('edge.jpg', 20 * MB)])).toEqual([]);
	});

	it('stops at 10 MB of compressed photos and says so (FR-7, AC-3)', async () => {
		const photos = new DonorPhotos(deps(() => 4 * MB));

		const refused = await pick(photos, [file('a.jpg'), file('b.jpg'), file('c.jpg')]);

		expect(refused).toEqual([['no_room', 'c.jpg']]);
		expect(photos.photoIds).toHaveLength(2);
		expect(photos.budget.bytes).toBe(8 * MB);
	});

	it('stops at 30 photos — the 31st is not taken (FR-3, AC-8)', async () => {
		const photos = new DonorPhotos(deps(() => 1000));
		const files = Array.from({ length: 31 }, (_, i) => file(`p${i}.jpg`));

		const refused = await pick(photos, files);

		expect(photos.photoIds).toHaveLength(30);
		expect(photos.budget.full).toBe(true);
		expect(refused).toEqual([['no_room', 'p30.jpg']]);
	});

	it('drops a photo whose upload failed and keeps the rest', async () => {
		const d = deps(() => 1000, {
			upload: vi
				.fn()
				.mockRejectedValueOnce(new Error('PHOTO_NOT_IMAGE'))
				.mockResolvedValueOnce('image:01K8PHXTX00000000000000009')
		});
		const photos = new DonorPhotos(d);

		const refused = await pick(photos, [file('bad.jpg'), file('good.jpg')]);

		expect(refused).toEqual([['upload_failed', 'bad.jpg']]);
		expect(photos.photoIds).toEqual(['image:01K8PHXTX00000000000000009']);
		expect(d.revokeUrl).toHaveBeenCalledTimes(1);
	});

	it('reads a file the browser cannot decode as unreadable', async () => {
		const photos = new DonorPhotos(
			deps(() => 1000, { compress: vi.fn().mockRejectedValue(new Error('decode')) })
		);
		expect(await pick(photos, [file('broken.heic')])).toEqual([['unreadable', 'broken.heic']]);
	});

	it('is busy while a photo is still uploading, and never sends one that is', async () => {
		let finish!: (id: string) => void;
		const d = deps(() => 1000, {
			upload: vi.fn(() => new Promise<string>((resolve) => (finish = resolve)))
		});
		const photos = new DonorPhotos(d);

		const adding = pick(photos, [file('slow.jpg')]);
		await vi.waitFor(() => expect(d.upload).toHaveBeenCalled());

		expect(photos.busy).toBe(true);
		expect(photos.photoIds).toEqual([]);
		// It already counts against the 10 MB while it uploads.
		expect(photos.budget.bytes).toBe(1000);

		finish('image:01K8PHXTX00000000000000001');
		await adding;
		expect(photos.busy).toBe(false);
		expect(photos.photoIds).toEqual(['image:01K8PHXTX00000000000000001']);
	});

	it('removes a photo and frees its share of the budget', async () => {
		const photos = new DonorPhotos(deps(() => 4 * MB));
		await pick(photos, [file('a.jpg'), file('b.jpg')]);

		photos.remove(photos.items[0].key);

		expect(photos.photoIds).toHaveLength(1);
		expect(await pick(photos, [file('c.jpg')])).toEqual([]);
	});
});
