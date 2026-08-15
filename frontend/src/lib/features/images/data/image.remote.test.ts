// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';

let shelterDb = 'shelter_sh001';
vi.mock('$lib/db/shelter', () => ({
	getShelterDb: () => shelterDb
}));

// compressImage's own resize/encode math is covered by image-compress.test.ts;
// here it's a collaborator at the repository boundary, mocked to a fixed result.
const { compressImageMock } = vi.hoisted(() => ({
	compressImageMock: vi.fn(async (file: File) => ({
		full: new Blob(['full-bytes'], { type: 'image/webp' }),
		thumbnail: new Blob(['thumb'], { type: 'image/webp' }),
		width: 800,
		height: 600,
		originalSize: file.size,
		compressedSize: 10,
		thumbnailSize: 5
	}))
}));
vi.mock('$lib/utils/image-compress', () => ({ compressImage: compressImageMock }));

interface StoredDoc {
	_id: string;
	_rev?: string;
	[key: string]: unknown;
}

let docs: Map<string, StoredDoc>;
let attachments: Map<string, Map<string, Blob>>;

function bumpRev(rev: string | undefined): string {
	const gen = rev ? parseInt(rev.split('-')[0], 10) + 1 : 1;
	return `${gen}-test`;
}

vi.mock('$lib/db/couch-db', () => ({
	putDoc: vi.fn(async (_dbName: string, doc: StoredDoc) => {
		const saved = { ...doc, _rev: bumpRev(doc._rev) };
		docs.set(doc._id, saved);
		return saved;
	}),
	getDoc: vi.fn(async (_dbName: string, id: string) => docs.get(id) ?? null),
	deleteDoc: vi.fn(async (_dbName: string, doc: { _id: string }) => {
		docs.delete(doc._id);
		attachments.delete(doc._id);
	}),
	allDocsByType: vi.fn(async (_dbName: string, _type: string, guard: (d: unknown) => boolean) =>
		[...docs.values()].filter(guard)
	),
	putAttachment: vi.fn(
		async (_dbName: string, docId: string, rev: string, name: string, blob: Blob) => {
			const forDoc = attachments.get(docId) ?? new Map<string, Blob>();
			forDoc.set(name, blob);
			attachments.set(docId, forDoc);
			const newRev = bumpRev(rev);
			const doc = docs.get(docId);
			if (doc) docs.set(docId, { ...doc, _rev: newRev });
			return { ok: true, id: docId, rev: newRev };
		}
	),
	getAttachment: vi.fn(
		async (_dbName: string, docId: string, name: string) =>
			attachments.get(docId)?.get(name) ?? null
	)
}));

import { deleteDoc, putAttachment } from '$lib/db/couch-db';
import { ImageRemoteRepository, imageRepository } from './image.remote';

const ctx = { shelterCode: 'SH001', createdBy: 'tester' };

function fakeFile(name: string, size: number): File {
	return new File([new Uint8Array(size)], name, { type: 'image/jpeg' });
}

describe('ImageRemoteRepository.saveImage', () => {
	let repo: ImageRemoteRepository;

	beforeEach(() => {
		docs = new Map();
		attachments = new Map();
		compressImageMock.mockClear();
		repo = new ImageRemoteRepository('shelter_sh001');
	});

	it('compresses the file, writes the doc, and attaches full + thumb blobs', async () => {
		const file = fakeFile('photo.jpg', 9999);
		const summary = await repo.saveImage(file, ctx, 'บ้านพัก 3');

		expect(compressImageMock).toHaveBeenCalledWith(file, {});
		expect(summary.filename).toBe('photo.jpg');
		expect(summary.caption).toBe('บ้านพัก 3');
		expect(summary.width).toBe(800);
		expect(summary.height).toBe(600);
		expect(summary.original_size).toBe(9999);
		expect(summary.compressed_size).toBe(10);
		expect(summary.thumbnail_size).toBe(5);

		const savedDoc = docs.get(summary._id);
		expect(savedDoc?.type).toBe('image');
		expect(savedDoc?.shelter_code).toBe('SH001');
		expect(savedDoc?.created_by).toBe('tester');

		const stored = attachments.get(summary._id);
		expect(await stored?.get('full')?.text()).toBe('full-bytes');
		expect(await stored?.get('thumb')?.text()).toBe('thumb');
	});

	it('defaults caption to an empty string when omitted', async () => {
		const summary = await repo.saveImage(fakeFile('photo.jpg', 100), ctx);
		expect(summary.caption).toBe('');
	});

	it('passes compression options through to compressImage', async () => {
		const file = fakeFile('photo.jpg', 100);
		await repo.saveImage(file, ctx, '', { maxPx: 500, quality: 0.5 });
		expect(compressImageMock).toHaveBeenCalledWith(file, { maxPx: 500, quality: 0.5 });
	});
});

describe('ImageRemoteRepository.saveImage attachment failure cleanup', () => {
	let repo: ImageRemoteRepository;

	beforeEach(() => {
		docs = new Map();
		attachments = new Map();
		vi.mocked(deleteDoc).mockClear();
		repo = new ImageRemoteRepository('shelter_sh001');
	});

	it('deletes the orphaned metadata doc when the full attachment upload fails', async () => {
		vi.mocked(putAttachment).mockRejectedValueOnce(new Error('network down'));

		await expect(repo.saveImage(fakeFile('a.jpg', 10), ctx)).rejects.toThrow('network down');

		expect(docs.size).toBe(0);
		expect(deleteDoc).toHaveBeenCalledTimes(1);
	});

	it('deletes the orphaned metadata doc when the thumbnail attachment upload fails', async () => {
		const defaultImpl = vi.mocked(putAttachment).getMockImplementation()!;
		vi.mocked(putAttachment)
			.mockImplementationOnce(defaultImpl) // "full" succeeds
			.mockRejectedValueOnce(new Error('thumb upload failed')); // "thumb" fails

		await expect(repo.saveImage(fakeFile('a.jpg', 10), ctx)).rejects.toThrow('thumb upload failed');

		expect(docs.size).toBe(0);
		expect(deleteDoc).toHaveBeenCalledTimes(1);
	});
});

describe('ImageRemoteRepository.listImages / getImage', () => {
	let repo: ImageRemoteRepository;

	beforeEach(() => {
		docs = new Map();
		attachments = new Map();
		repo = new ImageRemoteRepository('shelter_sh001');
	});

	it('lists every saved image', async () => {
		await repo.saveImage(fakeFile('a.jpg', 10), ctx);
		await repo.saveImage(fakeFile('b.jpg', 20), ctx);

		const listed = await repo.listImages();
		expect(listed).toHaveLength(2);
		expect(listed.map((i) => i.filename).sort()).toEqual(['a.jpg', 'b.jpg']);
	});

	it('getImage returns the summary for a known id', async () => {
		const saved = await repo.saveImage(fakeFile('a.jpg', 10), ctx);
		const got = await repo.getImage(saved._id);
		expect(got?._id).toBe(saved._id);
	});

	it('getImage returns null for an unknown id', async () => {
		expect(await repo.getImage('image:does-not-exist')).toBeNull();
	});
});

describe('ImageRemoteRepository.getFullImageUrl / getThumbnailUrl', () => {
	let repo: ImageRemoteRepository;

	beforeEach(() => {
		docs = new Map();
		attachments = new Map();
		repo = new ImageRemoteRepository('shelter_sh001');
	});

	it('resolves an object URL for the full attachment', async () => {
		const saved = await repo.saveImage(fakeFile('a.jpg', 10), ctx);
		const url = await repo.getFullImageUrl(saved._id);
		expect(url).toMatch(/^blob:/);
	});

	it('resolves an object URL for the thumbnail attachment', async () => {
		const saved = await repo.saveImage(fakeFile('a.jpg', 10), ctx);
		const url = await repo.getThumbnailUrl(saved._id);
		expect(url).toMatch(/^blob:/);
	});

	it('returns null when the attachment does not exist', async () => {
		expect(await repo.getFullImageUrl('image:missing')).toBeNull();
	});
});

describe('ImageRemoteRepository.deleteImage', () => {
	let repo: ImageRemoteRepository;

	beforeEach(() => {
		docs = new Map();
		attachments = new Map();
		vi.mocked(deleteDoc).mockClear();
		repo = new ImageRemoteRepository('shelter_sh001');
	});

	it('removes the doc so it no longer appears in listImages/getImage', async () => {
		const saved = await repo.saveImage(fakeFile('a.jpg', 10), ctx);
		await repo.deleteImage(saved._id);

		expect(await repo.getImage(saved._id)).toBeNull();
		expect(await repo.listImages()).toHaveLength(0);
	});

	it('forwards a supplied rev straight to deleteDoc, skipping the GET-for-latest-rev fallback', async () => {
		const saved = await repo.saveImage(fakeFile('a.jpg', 10), ctx);
		vi.mocked(deleteDoc).mockClear();

		await repo.deleteImage(saved._id, saved._rev);

		expect(deleteDoc).toHaveBeenCalledWith('shelter_sh001', {
			_id: saved._id,
			_rev: saved._rev
		});
	});

	it('omits rev when the caller does not supply one', async () => {
		const saved = await repo.saveImage(fakeFile('a.jpg', 10), ctx);
		vi.mocked(deleteDoc).mockClear();

		await repo.deleteImage(saved._id);

		expect(deleteDoc).toHaveBeenCalledWith('shelter_sh001', {
			_id: saved._id,
			_rev: undefined
		});
	});
});

describe('imageRepository singleton', () => {
	beforeEach(() => {
		docs = new Map();
		attachments = new Map();
		shelterDb = 'shelter_sh001';
	});

	it('reuses the same instance while the active shelter db is unchanged', () => {
		const first = imageRepository();
		const second = imageRepository();
		expect(first).toBe(second);
	});

	it('creates a new instance when the active shelter db changes', () => {
		const first = imageRepository();
		shelterDb = 'shelter_sh002';
		const second = imageRepository();
		expect(first).not.toBe(second);
	});
});
