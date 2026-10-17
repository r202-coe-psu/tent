import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/server/couch-admin', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/couch-admin')>()),
	adminRaw: vi.fn()
}));

import { adminRaw, ServiceError } from '$lib/server/couch-admin';
import type { KioskBannerInput } from '$lib/features/kiosk-banners';
import {
	BannerNotFoundError,
	createBanner,
	deleteBanner,
	getBanner,
	getBannerImage,
	KIOSK_BANNER_MANGO_INDEX,
	listActiveForShelter,
	listBannersForShelter,
	reorderBanners,
	setBannerStatus,
	updateBanner
} from './kiosk-banner.server';

const adminRawMock = vi.mocked(adminRaw);

const NOW = new Date('2026-10-15T03:00:00.000Z');
const input: KioskBannerInput = {
	title: 'ประกาศ',
	caption: null,
	order: 2,
	duration_sec: 10,
	start_at: '2026-10-01T00:00:00.000Z',
	end_at: '2026-11-01T00:00:00.000Z',
	status: 'active',
	screen_type: 'compact'
};
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const pngBase64 = Buffer.from(png).toString('base64');

beforeEach(() => {
	adminRawMock.mockReset();
});

describe('createBanner', () => {
	it('sends one PUT carrying the doc fields and the inline image attachment', async () => {
		adminRawMock.mockResolvedValue({ status: 201, data: { ok: true, id: 'x', rev: '1-a' } });

		const record = await createBanner(
			input,
			{ bytes: png, contentType: 'image/png' },
			{ shelterCode: 'SH1', createdBy: 'alice' },
			NOW
		);

		expect(adminRawMock).toHaveBeenCalledTimes(1);
		const [path, method, body] = adminRawMock.mock.calls[0];
		expect(method).toBe('PUT');
		expect(path).toBe(`/registry/${encodeURIComponent(record._id)}`);
		expect(body).toMatchObject({
			_id: record._id,
			type: 'kiosk_banner',
			shelter_code: 'SH1',
			created_by: 'alice',
			title: 'ประกาศ',
			_attachments: { image: { content_type: 'image/png', data: pngBase64 } }
		});
		expect(record._rev).toBe('1-a');
	});
});

const STUB = {
	content_type: 'image/jpeg',
	revpos: 1,
	digest: 'md5-abc',
	length: 1234,
	stub: true
};

function existingDoc(overrides: Record<string, unknown> = {}) {
	return {
		_id: 'kiosk_banner:b1',
		_rev: '1-a',
		type: 'kiosk_banner',
		schema_v: 1,
		shelter_code: 'SH1',
		title: 'เดิม',
		caption: null,
		order: 1,
		duration_sec: 10,
		start_at: '2026-10-01T00:00:00.000Z',
		end_at: '2026-11-01T00:00:00.000Z',
		status: 'active',
		created_at: '2026-09-01T00:00:00.000Z',
		updated_at: '2026-09-01T00:00:00.000Z',
		created_by: 'alice',
		_attachments: { image: STUB },
		...overrides
	};
}

describe('updateBanner', () => {
	it('keeps the existing attachment as a stub when no new image is given', async () => {
		adminRawMock.mockResolvedValueOnce({ status: 200, data: existingDoc() }).mockResolvedValueOnce({
			status: 201,
			data: { ok: true, id: 'kiosk_banner:b1', rev: '2-b' }
		});

		const record = await updateBanner(
			'kiosk_banner:b1',
			'1-a',
			{ ...input, title: 'ใหม่' },
			null,
			NOW
		);

		const [path, method, body] = adminRawMock.mock.calls[1];
		expect(method).toBe('PUT');
		expect(path).toBe('/registry/kiosk_banner%3Ab1');
		expect(body).toMatchObject({
			_id: 'kiosk_banner:b1',
			_rev: '1-a',
			shelter_code: 'SH1',
			created_at: '2026-09-01T00:00:00.000Z',
			created_by: 'alice',
			updated_at: NOW.toISOString(),
			title: 'ใหม่',
			_attachments: { image: STUB }
		});
		expect(record._rev).toBe('2-b');
		expect(record.image_content_type).toBe('image/jpeg');
		expect(record).not.toHaveProperty('_attachments');
	});

	it('writes screen_type, moving a legacy banner to portrait', async () => {
		adminRawMock.mockResolvedValueOnce({ status: 200, data: existingDoc() }).mockResolvedValueOnce({
			status: 201,
			data: { ok: true, id: 'kiosk_banner:b1', rev: '2-b' }
		});

		await updateBanner('kiosk_banner:b1', '1-a', { ...input, screen_type: 'portrait' }, null, NOW);

		expect(adminRawMock.mock.calls[1][2]).toMatchObject({ screen_type: 'portrait' });
	});

	it('inlines the new image when one is given', async () => {
		adminRawMock.mockResolvedValueOnce({ status: 200, data: existingDoc() }).mockResolvedValueOnce({
			status: 201,
			data: { ok: true, id: 'kiosk_banner:b1', rev: '2-b' }
		});

		const record = await updateBanner(
			'kiosk_banner:b1',
			'1-a',
			input,
			{ bytes: png, contentType: 'image/png' },
			NOW
		);

		const body = adminRawMock.mock.calls[1][2] as { _attachments: unknown };
		expect(body._attachments).toEqual({ image: { content_type: 'image/png', data: pngBase64 } });
		expect(record.image_content_type).toBe('image/png');
	});

	it('rejects a stale rev with CONFLICT and never PUTs', async () => {
		adminRawMock.mockResolvedValueOnce({ status: 200, data: existingDoc({ _rev: '2-z' }) });

		await expect(updateBanner('kiosk_banner:b1', '1-a', input, null, NOW)).rejects.toMatchObject({
			code: 'CONFLICT'
		});
		expect(adminRawMock).toHaveBeenCalledTimes(1);
	});

	it('maps a CouchDB 409 on the PUT to CONFLICT', async () => {
		adminRawMock
			.mockResolvedValueOnce({ status: 200, data: existingDoc() })
			.mockResolvedValueOnce({ status: 409, data: { error: 'conflict' } });

		const err = await updateBanner('kiosk_banner:b1', '1-a', input, null, NOW).catch((e) => e);
		expect(err).toBeInstanceOf(ServiceError);
		expect(err.code).toBe('CONFLICT');
	});
});

describe('setBannerStatus', () => {
	it('flips only status and updated_at, keeping the attachment stub', async () => {
		adminRawMock.mockResolvedValueOnce({ status: 200, data: existingDoc() }).mockResolvedValueOnce({
			status: 201,
			data: { ok: true, id: 'kiosk_banner:b1', rev: '2-b' }
		});

		const record = await setBannerStatus('kiosk_banner:b1', '1-a', 'inactive', NOW);

		const body = adminRawMock.mock.calls[1][2];
		expect(body).toMatchObject({
			title: 'เดิม',
			status: 'inactive',
			updated_at: NOW.toISOString(),
			_attachments: { image: STUB }
		});
		expect(record.status).toBe('inactive');
	});
});

describe('getBanner', () => {
	it('returns a record without _attachments, exposing image_content_type', async () => {
		adminRawMock.mockResolvedValue({ status: 200, data: existingDoc() });

		const record = await getBanner('kiosk_banner:b1');

		expect(record).toMatchObject({ _id: 'kiosk_banner:b1', image_content_type: 'image/jpeg' });
		expect(record).not.toHaveProperty('_attachments');
	});

	it('returns null on 404', async () => {
		adminRawMock.mockResolvedValue({ status: 404, data: { error: 'not_found' } });

		expect(await getBanner('kiosk_banner:nope')).toBeNull();
	});
});

describe('deleteBanner', () => {
	it('DELETEs with the rev as a query parameter', async () => {
		adminRawMock.mockResolvedValue({ status: 200, data: { ok: true } });

		await deleteBanner('kiosk_banner:b1', '1-a');

		expect(adminRawMock).toHaveBeenCalledWith('/registry/kiosk_banner%3Ab1?rev=1-a', 'DELETE');
	});

	it('maps 409 to CONFLICT', async () => {
		adminRawMock.mockResolvedValue({ status: 409, data: { error: 'conflict' } });

		await expect(deleteBanner('kiosk_banner:b1', '1-a')).rejects.toMatchObject({
			code: 'CONFLICT'
		});
	});

	it('throws BannerNotFoundError on 404', async () => {
		adminRawMock.mockResolvedValue({ status: 404, data: { error: 'not_found' } });

		await expect(deleteBanner('kiosk_banner:b1', '1-a')).rejects.toBeInstanceOf(
			BannerNotFoundError
		);
	});
});

describe('listBannersForShelter', () => {
	it('queries by type and shelter_code and strips _attachments', async () => {
		adminRawMock.mockResolvedValue({ status: 200, data: { docs: [existingDoc()] } });

		const records = await listBannersForShelter('SH1');

		const [path, method, body] = adminRawMock.mock.calls[0];
		expect(path).toBe('/registry/_find');
		expect(method).toBe('POST');
		expect(body).toMatchObject({
			selector: { type: 'kiosk_banner', shelter_code: 'SH1' },
			limit: 500
		});
		expect(records).toHaveLength(1);
		expect(records[0].image_content_type).toBe('image/jpeg');
		expect(records[0]).not.toHaveProperty('_attachments');
	});
});

describe('reorderBanners', () => {
	const doc = (n: number, overrides: Record<string, unknown> = {}) =>
		existingDoc({ _id: `kiosk_banner:b${n}`, _rev: `1-r${n}`, order: n, ...overrides });
	const rowsFor = (...ids: string[]) =>
		ids.map((id) => ({ ok: true, id, rev: `2-${id.slice(-2)}` }));

	it('bulk-writes only the changed banners with new orders, keeping rev and attachment stubs', async () => {
		adminRawMock
			.mockResolvedValueOnce({ status: 200, data: { docs: [doc(1), doc(2), doc(3)] } })
			.mockResolvedValueOnce({
				status: 201,
				data: rowsFor('kiosk_banner:b2', 'kiosk_banner:b3')
			});

		await reorderBanners(
			'SH1',
			'compact',
			[
				{ id: 'kiosk_banner:b1', rev: '1-r1' },
				{ id: 'kiosk_banner:b3', rev: '1-r3' },
				{ id: 'kiosk_banner:b2', rev: '1-r2' }
			],
			NOW
		);

		expect(adminRawMock).toHaveBeenCalledTimes(2);
		const [path, method, body] = adminRawMock.mock.calls[1];
		expect(path).toBe('/registry/_bulk_docs');
		expect(method).toBe('POST');
		expect(body).toEqual({
			docs: [
				doc(2, { order: 3, updated_at: NOW.toISOString() }),
				doc(3, { order: 2, updated_at: NOW.toISOString() })
			]
		});
	});

	it('writes nothing when the order is unchanged and returns the current list', async () => {
		adminRawMock.mockResolvedValueOnce({ status: 200, data: { docs: [doc(2), doc(1)] } });

		const records = await reorderBanners(
			'SH1',
			'compact',
			[
				{ id: 'kiosk_banner:b1', rev: '1-r1' },
				{ id: 'kiosk_banner:b2', rev: '1-r2' }
			],
			NOW
		);

		expect(adminRawMock).toHaveBeenCalledTimes(1);
		expect(records.map((r) => r._id)).toEqual(['kiosk_banner:b1', 'kiosk_banner:b2']);
	});

	it('rejects a stale rev with CONFLICT before any write', async () => {
		adminRawMock.mockResolvedValueOnce({ status: 200, data: { docs: [doc(1), doc(2)] } });

		await expect(
			reorderBanners(
				'SH1',
				'compact',
				[
					{ id: 'kiosk_banner:b2', rev: '0-old' },
					{ id: 'kiosk_banner:b1', rev: '1-r1' }
				],
				NOW
			)
		).rejects.toMatchObject({ code: 'CONFLICT', message: 'Banner was modified by someone else' });
		expect(adminRawMock).toHaveBeenCalledTimes(1);
	});

	it.each([
		['an unknown id', [{ id: 'kiosk_banner:zz', rev: '1-zz' }]],
		['a portrait banner', [{ id: 'kiosk_banner:p', rev: '1-p' }]],
		['an expired banner', [{ id: 'kiosk_banner:old', rev: '1-old' }]]
	])('rejects %s in the ordered ids with CONFLICT before any write', async (_name, extra) => {
		adminRawMock.mockResolvedValueOnce({
			status: 200,
			data: {
				docs: [
					doc(1),
					doc(2),
					existingDoc({ _id: 'kiosk_banner:p', _rev: '1-p', screen_type: 'portrait' }),
					existingDoc({
						_id: 'kiosk_banner:old',
						_rev: '1-old',
						start_at: '2026-01-01T00:00:00.000Z',
						end_at: '2026-02-01T00:00:00.000Z'
					})
				]
			}
		});

		await expect(
			reorderBanners(
				'SH1',
				'compact',
				[{ id: 'kiosk_banner:b2', rev: '1-r2' }, { id: 'kiosk_banner:b1', rev: '1-r1' }, ...extra],
				NOW
			)
		).rejects.toMatchObject({ code: 'CONFLICT' });
		expect(adminRawMock).toHaveBeenCalledTimes(1);
	});

	it('rejects a repeated id with VALIDATION', async () => {
		adminRawMock.mockResolvedValueOnce({ status: 200, data: { docs: [doc(1), doc(2)] } });

		await expect(
			reorderBanners(
				'SH1',
				'compact',
				[
					{ id: 'kiosk_banner:b1', rev: '1-r1' },
					{ id: 'kiosk_banner:b1', rev: '1-r1' }
				],
				NOW
			)
		).rejects.toMatchObject({ code: 'VALIDATION' });
		expect(adminRawMock).toHaveBeenCalledTimes(1);
	});

	describe('bulk write failures', () => {
		const swap = [
			{ id: 'kiosk_banner:b2', rev: '1-r2' },
			{ id: 'kiosk_banner:b1', rev: '1-r1' }
		];
		const run = (bulk: { status: number; data: unknown }) => {
			adminRawMock
				.mockResolvedValueOnce({ status: 200, data: { docs: [doc(1), doc(2)] } })
				.mockResolvedValueOnce(bulk);
			return reorderBanners('SH1', 'compact', swap, NOW);
		};

		it('maps a conflicting row to CONFLICT', async () => {
			await expect(
				run({
					status: 201,
					data: [
						{ ok: true, id: 'kiosk_banner:b1', rev: '2-b1' },
						{ id: 'kiosk_banner:b2', error: 'conflict', reason: 'Document update conflict.' }
					]
				})
			).rejects.toMatchObject({ code: 'CONFLICT' });
		});

		it('maps any other failed row to INTERNAL', async () => {
			await expect(
				run({ status: 201, data: [{ id: 'kiosk_banner:b1', error: 'forbidden', reason: 'no' }] })
			).rejects.toMatchObject({ code: 'INTERNAL' });
		});

		it('maps an HTTP error to INTERNAL', async () => {
			await expect(run({ status: 500, data: { error: 'boom' } })).rejects.toMatchObject({
				code: 'INTERNAL'
			});
		});
	});

	it('returns the reordered banners with their new rev, order and updated_at', async () => {
		adminRawMock
			.mockResolvedValueOnce({ status: 200, data: { docs: [doc(1), doc(2), doc(3)] } })
			.mockResolvedValueOnce({
				status: 201,
				data: [
					{ ok: true, id: 'kiosk_banner:b1', rev: '2-b1' },
					{ ok: true, id: 'kiosk_banner:b3', rev: '2-b3' }
				]
			});

		const records = await reorderBanners(
			'SH1',
			'compact',
			[
				{ id: 'kiosk_banner:b3', rev: '1-r3' },
				{ id: 'kiosk_banner:b2', rev: '1-r2' },
				{ id: 'kiosk_banner:b1', rev: '1-r1' }
			],
			NOW
		);

		expect(records.map((r) => [r._id, r.order, r._rev])).toEqual([
			['kiosk_banner:b3', 1, '2-b3'],
			['kiosk_banner:b2', 2, '1-r2'],
			['kiosk_banner:b1', 3, '2-b1']
		]);
		expect(records[0].updated_at).toBe(NOW.toISOString());
		expect(records[1].updated_at).toBe('2026-09-01T00:00:00.000Z');
		expect(records[0]).not.toHaveProperty('_attachments');
		expect(records[0].image_content_type).toBe('image/jpeg');
	});
});

describe('listActiveForShelter', () => {
	it('keeps only banners live now, sorted, capped at 20', async () => {
		const live = (n: number, order: number) =>
			existingDoc({ _id: `kiosk_banner:live-${String(n).padStart(2, '0')}`, order });
		const docs = [
			...Array.from({ length: 22 }, (_, i) => live(i, 22 - i)),
			existingDoc({ _id: 'kiosk_banner:off', status: 'inactive', order: 0 }),
			existingDoc({
				_id: 'kiosk_banner:future',
				start_at: '2026-12-01T00:00:00.000Z',
				end_at: '2026-12-31T00:00:00.000Z',
				order: 0
			}),
			existingDoc({
				_id: 'kiosk_banner:expired',
				start_at: '2026-01-01T00:00:00.000Z',
				end_at: '2026-02-01T00:00:00.000Z',
				order: 0
			})
		];
		adminRawMock.mockResolvedValue({ status: 200, data: { docs } });

		const records = await listActiveForShelter('SH1', NOW, 'compact');

		expect(records).toHaveLength(20);
		expect(records.map((r) => r.order)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
		expect(records.some((r) => ['off', 'future', 'expired'].some((k) => r._id.endsWith(k)))).toBe(
			false
		);
	});
});

describe('listActiveForShelter by screen type', () => {
	it('returns only the requested screen type, a legacy doc counting as compact', async () => {
		adminRawMock.mockResolvedValue({
			status: 200,
			data: {
				docs: [
					existingDoc({ _id: 'kiosk_banner:legacy' }),
					existingDoc({ _id: 'kiosk_banner:c', screen_type: 'compact' }),
					existingDoc({ _id: 'kiosk_banner:p', screen_type: 'portrait' })
				]
			}
		});

		const compact = await listActiveForShelter('SH1', NOW, 'compact');
		const portrait = await listActiveForShelter('SH1', NOW, 'portrait');

		expect(compact.map((r) => r._id).sort()).toEqual(['kiosk_banner:c', 'kiosk_banner:legacy']);
		expect(portrait.map((r) => r._id)).toEqual(['kiosk_banner:p']);
	});

	it('applies the cap of 20 after filtering by screen type', async () => {
		const docs = [
			...Array.from({ length: 5 }, (_, i) =>
				existingDoc({ _id: `kiosk_banner:c-${i}`, order: 1, screen_type: 'compact' })
			),
			...Array.from({ length: 22 }, (_, i) =>
				existingDoc({
					_id: `kiosk_banner:p-${String(i).padStart(2, '0')}`,
					order: 2 + i,
					screen_type: 'portrait'
				})
			)
		];
		adminRawMock.mockResolvedValue({ status: 200, data: { docs } });

		const portrait = await listActiveForShelter('SH1', NOW, 'portrait');

		expect(portrait).toHaveLength(20);
		expect(portrait.every((r) => r._id.startsWith('kiosk_banner:p-'))).toBe(true);
		expect(await listActiveForShelter('SH1', NOW, 'compact')).toHaveLength(5);
	});
});

describe('getBannerImage', () => {
	it('decodes the inline attachment fetched with attachments=true', async () => {
		adminRawMock.mockResolvedValue({
			status: 200,
			data: existingDoc({ _attachments: { image: { content_type: 'image/png', data: pngBase64 } } })
		});

		const image = await getBannerImage('kiosk_banner:b1');

		expect(adminRawMock).toHaveBeenCalledWith(
			'/registry/kiosk_banner%3Ab1?attachments=true',
			'GET'
		);
		expect(image?.contentType).toBe('image/png');
		expect(Array.from(new Uint8Array(image!.bytes))).toEqual(Array.from(png));
	});

	it('returns null when the doc or attachment is missing', async () => {
		adminRawMock.mockResolvedValueOnce({ status: 404, data: { error: 'not_found' } });
		expect(await getBannerImage('kiosk_banner:x')).toBeNull();

		adminRawMock.mockResolvedValueOnce({
			status: 200,
			data: existingDoc({ _attachments: undefined })
		});
		expect(await getBannerImage('kiosk_banner:y')).toBeNull();
	});
});

describe('KIOSK_BANNER_MANGO_INDEX', () => {
	it('indexes type, shelter_code and end_at', () => {
		expect(KIOSK_BANNER_MANGO_INDEX.index.fields).toEqual(['type', 'shelter_code', 'end_at']);
	});
});
