import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/server/couch-admin', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/couch-admin')>()),
	adminRaw: vi.fn()
}));

import { adminRaw, ServiceError } from '$lib/server/couch-admin';
import type { KioskBannerInput, KioskBannerTemplate } from '$lib/features/kiosk-banners';
import {
	BannerNotFoundError,
	createBanner,
	deleteBanner,
	getBanner,
	getBannerImage,
	getBannerTemplateImage,
	listActiveForShelter,
	listBannersForShelter,
	reorderBanners,
	setBannerStatus,
	updateBanner
} from './kiosk-banner.server';

const adminRawMock = vi.mocked(adminRaw);

const NOW = new Date('2026-10-15T03:00:00.000Z');
const GROUP_A = 'kiosk_banner_group:A';
const GROUP_B = 'kiosk_banner_group:B';
const input: KioskBannerInput = {
	group_id: GROUP_A,
	title: 'ประกาศ',
	caption: null,
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

const BYTES = { bytes: png, contentType: 'image/png' } as const;
const LOGO_BYTES = { bytes: new Uint8Array([9, 8, 7]), contentType: 'image/jpeg' } as const;
const logoBase64 = Buffer.from(LOGO_BYTES.bytes).toString('base64');
const TEMPLATE: KioskBannerTemplate = {
	heading: 'หัวข้อ',
	body: '',
	align: 'center',
	bg_color: '#1e3a8a',
	text_color: '#ffffff',
	image: 'template_image'
};
const TEMPLATE_NO_IMAGE: KioskBannerTemplate = { ...TEMPLATE, image: null };
const CTX = { shelterCode: 'SH1', createdBy: 'alice' };
const SLOT = { groupId: GROUP_A, screenType: 'compact' } as const;
const FOUND_NONE = { status: 200, data: { docs: [] } };

describe('createBanner', () => {
	it('sends one PUT carrying the doc fields and the inline image attachment', async () => {
		adminRawMock
			.mockResolvedValueOnce(FOUND_NONE)
			.mockResolvedValueOnce({ status: 201, data: { ok: true, id: 'x', rev: '1-a' } });

		const record = await createBanner(input, { image: BYTES }, CTX, NOW);

		expect(adminRawMock).toHaveBeenCalledTimes(2);
		const [findPath, findMethod, findBody] = adminRawMock.mock.calls[0];
		expect(findPath).toBe('/registry/_find');
		expect(findMethod).toBe('POST');
		expect(findBody).toMatchObject({ selector: { type: 'kiosk_banner', shelter_code: 'SH1' } });
		const [path, method, body] = adminRawMock.mock.calls[1];
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

	it('gives the first banner of a screen type order 1', async () => {
		adminRawMock
			.mockResolvedValueOnce(FOUND_NONE)
			.mockResolvedValueOnce({ status: 201, data: { ok: true, id: 'x', rev: '1-a' } });

		const record = await createBanner(input, { image: BYTES }, CTX, NOW);

		expect(record.order).toBe(1);
		expect(adminRawMock.mock.calls[1][2]).toMatchObject({ order: 1 });
	});

	it('appends after the highest current order of the same screen type', async () => {
		adminRawMock
			.mockResolvedValueOnce({
				status: 200,
				data: {
					docs: [
						existingDoc({ _id: 'kiosk_banner:a', order: 2 }),
						existingDoc({ _id: 'kiosk_banner:b', order: 5, screen_type: 'compact' })
					]
				}
			})
			.mockResolvedValueOnce({ status: 201, data: { ok: true, id: 'x', rev: '1-a' } });

		const record = await createBanner(input, { image: BYTES }, CTX, NOW);

		expect(record.order).toBe(6);
		expect(adminRawMock.mock.calls[1][2]).toMatchObject({ order: 6 });
	});

	it('ignores other screen types and expired banners', async () => {
		adminRawMock
			.mockResolvedValueOnce({
				status: 200,
				data: {
					docs: [
						existingDoc({ _id: 'kiosk_banner:a', order: 3 }),
						existingDoc({ _id: 'kiosk_banner:b', order: 9, screen_type: 'portrait' }),
						existingDoc({ _id: 'kiosk_banner:c', order: 8, end_at: '2026-10-01T00:00:00.000Z' })
					]
				}
			})
			.mockResolvedValueOnce({ status: 201, data: { ok: true, id: 'x', rev: '1-a' } });

		const record = await createBanner(input, { image: BYTES }, CTX, NOW);

		expect(record.order).toBe(4);
	});

	it('counts only the input group, not other groups or ungrouped banners', async () => {
		adminRawMock
			.mockResolvedValueOnce({
				status: 200,
				data: {
					docs: [
						existingDoc({ _id: 'kiosk_banner:a', order: 3 }),
						existingDoc({ _id: 'kiosk_banner:b', order: 9, group_id: GROUP_B }),
						existingDoc({ _id: 'kiosk_banner:c', order: 8, schema_v: 1, group_id: undefined })
					]
				}
			})
			.mockResolvedValueOnce({ status: 201, data: { ok: true, id: 'x', rev: '1-a' } });

		const record = await createBanner(input, { image: BYTES }, CTX, NOW);

		expect(record.order).toBe(4);
	});

	it('writes a v4 doc carrying the input group', async () => {
		adminRawMock
			.mockResolvedValueOnce(FOUND_NONE)
			.mockResolvedValueOnce({ status: 201, data: { ok: true, id: 'x', rev: '1-a' } });

		await createBanner(input, { image: BYTES }, CTX, NOW);

		expect(adminRawMock.mock.calls[1][2]).toMatchObject({ schema_v: 4, group_id: GROUP_A });
	});

	it('ignores an order smuggled in the input', async () => {
		adminRawMock
			.mockResolvedValueOnce(FOUND_NONE)
			.mockResolvedValueOnce({ status: 201, data: { ok: true, id: 'x', rev: '1-a' } });

		const record = await createBanner(
			{ ...input, order: 7 } as KioskBannerInput,
			{ image: BYTES },
			CTX,
			NOW
		);

		expect(record.order).toBe(1);
	});

	it('writes the template with both the image and the template_image attachments', async () => {
		adminRawMock
			.mockResolvedValueOnce(FOUND_NONE)
			.mockResolvedValueOnce({ status: 201, data: { ok: true, id: 'x', rev: '1-a' } });

		await createBanner(
			{ ...input, template: TEMPLATE },
			{ image: BYTES, templateImage: LOGO_BYTES },
			CTX,
			NOW
		);

		const body = adminRawMock.mock.calls[1][2] as { _attachments: unknown };
		expect(body).toMatchObject({ template: TEMPLATE });
		expect(body._attachments).toEqual({
			image: { content_type: 'image/png', data: pngBase64 },
			template_image: { content_type: 'image/jpeg', data: logoBase64 }
		});
	});

	it('rejects a template that references template_image when no logo is sent', async () => {
		const err = await createBanner(
			{ ...input, template: TEMPLATE },
			{ image: BYTES },
			CTX,
			NOW
		).catch((e) => e);

		expect(err).toBeInstanceOf(ServiceError);
		expect(err).toMatchObject({ code: 'VALIDATION', message: 'เลือกรูปในประกาศ' });
		expect(adminRawMock).not.toHaveBeenCalled();
	});

	it.each([
		['has no template', undefined],
		['has a template without an image', TEMPLATE_NO_IMAGE]
	])('rejects a logo when the banner %s', async (_name, template) => {
		await expect(
			createBanner({ ...input, template }, { image: BYTES, templateImage: LOGO_BYTES }, CTX, NOW)
		).rejects.toMatchObject({ code: 'VALIDATION' });
		expect(adminRawMock).not.toHaveBeenCalled();
	});
});

const STUB = {
	content_type: 'image/jpeg',
	revpos: 1,
	digest: 'md5-abc',
	length: 1234,
	stub: true
};

const LOGO_STUB = { ...STUB, content_type: 'image/webp', digest: 'md5-logo' };

function existingDoc(overrides: Record<string, unknown> = {}) {
	return {
		_id: 'kiosk_banner:b1',
		_rev: '1-a',
		type: 'kiosk_banner',
		schema_v: 2,
		group_id: GROUP_A,
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
			{ image: null },
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
		adminRawMock
			.mockResolvedValueOnce({ status: 200, data: existingDoc() })
			.mockResolvedValueOnce(FOUND_NONE)
			.mockResolvedValueOnce({
				status: 201,
				data: { ok: true, id: 'kiosk_banner:b1', rev: '2-b' }
			});

		await updateBanner(
			'kiosk_banner:b1',
			'1-a',
			{ ...input, screen_type: 'portrait' },
			{ image: null },
			NOW
		);

		expect(adminRawMock.mock.calls[2][2]).toMatchObject({ screen_type: 'portrait', order: 1 });
	});

	it('keeps the stored order and reads no other banners when the screen type is unchanged', async () => {
		adminRawMock
			.mockResolvedValueOnce({ status: 200, data: existingDoc({ order: 4 }) })
			.mockResolvedValueOnce({
				status: 201,
				data: { ok: true, id: 'kiosk_banner:b1', rev: '2-b' }
			});

		const record = await updateBanner('kiosk_banner:b1', '1-a', input, { image: null }, NOW);

		expect(adminRawMock).toHaveBeenCalledTimes(2);
		expect(adminRawMock.mock.calls[1][2]).toMatchObject({ order: 4 });
		expect(record.order).toBe(4);
	});

	it('never writes an order smuggled in the input', async () => {
		adminRawMock
			.mockResolvedValueOnce({ status: 200, data: existingDoc({ order: 4 }) })
			.mockResolvedValueOnce({
				status: 201,
				data: { ok: true, id: 'kiosk_banner:b1', rev: '2-b' }
			});

		await updateBanner(
			'kiosk_banner:b1',
			'1-a',
			{ ...input, order: 9 } as KioskBannerInput,
			{ image: null },
			NOW
		);

		expect(adminRawMock.mock.calls[1][2]).toMatchObject({ order: 4 });
	});

	it('appends to the end of the new screen type when the screen type changes', async () => {
		adminRawMock
			.mockResolvedValueOnce({ status: 200, data: existingDoc({ order: 1 }) })
			.mockResolvedValueOnce({
				status: 200,
				data: {
					docs: [
						existingDoc({ order: 1 }),
						existingDoc({ _id: 'kiosk_banner:p1', order: 2, screen_type: 'portrait' }),
						existingDoc({ _id: 'kiosk_banner:p2', order: 5, screen_type: 'portrait' }),
						existingDoc({
							_id: 'kiosk_banner:p3',
							order: 9,
							screen_type: 'portrait',
							end_at: '2026-10-01T00:00:00.000Z'
						})
					]
				}
			})
			.mockResolvedValueOnce({
				status: 201,
				data: { ok: true, id: 'kiosk_banner:b1', rev: '2-b' }
			});

		const record = await updateBanner(
			'kiosk_banner:b1',
			'1-a',
			{ ...input, screen_type: 'portrait' },
			{ image: null },
			NOW
		);

		const [findPath, , findBody] = adminRawMock.mock.calls[1];
		expect(findPath).toBe('/registry/_find');
		expect(findBody).toMatchObject({ selector: { type: 'kiosk_banner', shelter_code: 'SH1' } });
		expect(adminRawMock.mock.calls[2][2]).toMatchObject({ screen_type: 'portrait', order: 6 });
		expect(record.order).toBe(6);
	});

	it('appends to the end of the new group when the group changes, keeping the screen type', async () => {
		adminRawMock
			.mockResolvedValueOnce({ status: 200, data: existingDoc({ order: 1 }) })
			.mockResolvedValueOnce({
				status: 200,
				data: {
					docs: [
						existingDoc({ order: 1 }),
						existingDoc({ _id: 'kiosk_banner:g1', order: 2, group_id: GROUP_B }),
						existingDoc({ _id: 'kiosk_banner:g2', order: 5, group_id: GROUP_B }),
						existingDoc({
							_id: 'kiosk_banner:g3',
							order: 7,
							group_id: GROUP_B,
							screen_type: 'portrait'
						})
					]
				}
			})
			.mockResolvedValueOnce({
				status: 201,
				data: { ok: true, id: 'kiosk_banner:b1', rev: '2-b' }
			});

		const record = await updateBanner(
			'kiosk_banner:b1',
			'1-a',
			{ ...input, group_id: GROUP_B },
			{ image: null },
			NOW
		);

		expect(adminRawMock.mock.calls[2][2]).toMatchObject({ group_id: GROUP_B, order: 6 });
		expect(record.order).toBe(6);
	});

	it('turns an ungrouped v1 banner into v4 in the chosen group, at the end of its slot', async () => {
		adminRawMock
			.mockResolvedValueOnce({
				status: 200,
				data: existingDoc({ schema_v: 1, group_id: undefined, order: 3 })
			})
			.mockResolvedValueOnce({
				status: 200,
				data: { docs: [existingDoc({ _id: 'kiosk_banner:a1', order: 4 })] }
			})
			.mockResolvedValueOnce({
				status: 201,
				data: { ok: true, id: 'kiosk_banner:b1', rev: '2-b' }
			});

		const record = await updateBanner('kiosk_banner:b1', '1-a', input, { image: null }, NOW);

		expect(adminRawMock.mock.calls[2][2]).toMatchObject({
			schema_v: 4,
			group_id: GROUP_A,
			order: 5
		});
		expect(record.order).toBe(5);
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
			{ image: { bytes: png, contentType: 'image/png' } },
			NOW
		);

		const body = adminRawMock.mock.calls[1][2] as { _attachments: unknown };
		expect(body._attachments).toEqual({ image: { content_type: 'image/png', data: pngBase64 } });
		expect(record.image_content_type).toBe('image/png');
	});

	describe('with a template', () => {
		const ok = { status: 201, data: { ok: true, id: 'kiosk_banner:b1', rev: '2-b' } };
		const withLogo = (overrides: Record<string, unknown> = {}) =>
			existingDoc({
				schema_v: 4,
				template: TEMPLATE,
				_attachments: { image: STUB, template_image: LOGO_STUB },
				...overrides
			});
		const putBody = () =>
			adminRawMock.mock.calls.find((c) => c[1] === 'PUT')![2] as Record<string, unknown> & {
				_attachments: Record<string, unknown>;
			};

		it('keeps the template_image stub when only a new image is sent', async () => {
			adminRawMock
				.mockResolvedValueOnce({ status: 200, data: withLogo() })
				.mockResolvedValueOnce(ok);

			await updateBanner(
				'kiosk_banner:b1',
				'1-a',
				{ ...input, template: TEMPLATE },
				{ image: BYTES },
				NOW
			);

			expect(putBody()._attachments).toEqual({
				image: { content_type: 'image/png', data: pngBase64 },
				template_image: LOGO_STUB
			});
		});

		it('replaces template_image with a new logo and keeps the image stub', async () => {
			adminRawMock
				.mockResolvedValueOnce({ status: 200, data: withLogo() })
				.mockResolvedValueOnce(ok);

			await updateBanner(
				'kiosk_banner:b1',
				'1-a',
				{ ...input, template: TEMPLATE },
				{ image: null, templateImage: LOGO_BYTES },
				NOW
			);

			expect(putBody()._attachments).toEqual({
				image: STUB,
				template_image: { content_type: 'image/jpeg', data: logoBase64 }
			});
		});

		it('writes the input template into the doc', async () => {
			adminRawMock
				.mockResolvedValueOnce({ status: 200, data: withLogo() })
				.mockResolvedValueOnce(ok);

			await updateBanner(
				'kiosk_banner:b1',
				'1-a',
				{ ...input, template: { ...TEMPLATE, heading: 'แก้แล้ว', align: 'left' } },
				{ image: null },
				NOW
			);

			expect(putBody().template).toEqual({ ...TEMPLATE, heading: 'แก้แล้ว', align: 'left' });
		});

		it('drops the template and its template_image when switched back to an uploaded image', async () => {
			adminRawMock
				.mockResolvedValueOnce({ status: 200, data: withLogo() })
				.mockResolvedValueOnce(ok);

			await updateBanner('kiosk_banner:b1', '1-a', input, { image: BYTES }, NOW);

			expect(putBody()).not.toHaveProperty('template');
			expect(Object.keys(putBody()._attachments)).toEqual(['image']);
		});

		it('drops the template_image attachment when the template no longer references it', async () => {
			adminRawMock
				.mockResolvedValueOnce({ status: 200, data: withLogo() })
				.mockResolvedValueOnce(ok);

			await updateBanner(
				'kiosk_banner:b1',
				'1-a',
				{ ...input, template: TEMPLATE_NO_IMAGE },
				{ image: null },
				NOW
			);

			expect(putBody()._attachments).toEqual({ image: STUB });
			expect(putBody().template).toEqual(TEMPLATE_NO_IMAGE);
		});

		it('rejects a template that references template_image when no logo exists or is sent', async () => {
			adminRawMock.mockResolvedValueOnce({
				status: 200,
				data: existingDoc({ schema_v: 4 })
			});

			await expect(
				updateBanner(
					'kiosk_banner:b1',
					'1-a',
					{ ...input, template: TEMPLATE },
					{ image: BYTES },
					NOW
				)
			).rejects.toMatchObject({ code: 'VALIDATION', message: 'เลือกรูปในประกาศ' });
			expect(adminRawMock).toHaveBeenCalledTimes(1);
		});

		it.each([
			['has no template', undefined],
			['has a template without an image', TEMPLATE_NO_IMAGE]
		])('rejects a new logo when the banner %s', async (_name, template) => {
			adminRawMock.mockResolvedValueOnce({ status: 200, data: existingDoc({ schema_v: 4 }) });

			await expect(
				updateBanner(
					'kiosk_banner:b1',
					'1-a',
					{ ...input, template },
					{ image: null, templateImage: LOGO_BYTES },
					NOW
				)
			).rejects.toMatchObject({ code: 'VALIDATION' });
			expect(adminRawMock).toHaveBeenCalledTimes(1);
		});
	});

	it('rejects a stale rev with CONFLICT and never PUTs', async () => {
		adminRawMock.mockResolvedValueOnce({ status: 200, data: existingDoc({ _rev: '2-z' }) });

		await expect(
			updateBanner('kiosk_banner:b1', '1-a', input, { image: null }, NOW)
		).rejects.toMatchObject({
			code: 'CONFLICT'
		});
		expect(adminRawMock).toHaveBeenCalledTimes(1);
	});

	it('maps a CouchDB 409 on the PUT to CONFLICT', async () => {
		adminRawMock
			.mockResolvedValueOnce({ status: 200, data: existingDoc() })
			.mockResolvedValueOnce({ status: 409, data: { error: 'conflict' } });

		const err = await updateBanner('kiosk_banner:b1', '1-a', input, { image: null }, NOW).catch(
			(e) => e
		);
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

	it('keeps the template and the template_image stub', async () => {
		adminRawMock
			.mockResolvedValueOnce({
				status: 200,
				data: existingDoc({
					schema_v: 4,
					template: TEMPLATE,
					_attachments: { image: STUB, template_image: LOGO_STUB }
				})
			})
			.mockResolvedValueOnce({
				status: 201,
				data: { ok: true, id: 'kiosk_banner:b1', rev: '2-b' }
			});

		await setBannerStatus('kiosk_banner:b1', '1-a', 'inactive', NOW);

		const body = adminRawMock.mock.calls[1][2] as Record<string, unknown>;
		expect(body.template).toEqual(TEMPLATE);
		expect(body._attachments).toEqual({ image: STUB, template_image: LOGO_STUB });
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
			SLOT,
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

	it('keeps the template and the template_image stub of a reordered template banner', async () => {
		const templated = (n: number) =>
			doc(n, {
				schema_v: 4,
				template: TEMPLATE,
				_attachments: { image: STUB, template_image: LOGO_STUB }
			});
		adminRawMock
			.mockResolvedValueOnce({ status: 200, data: { docs: [templated(1), templated(2)] } })
			.mockResolvedValueOnce({
				status: 201,
				data: rowsFor('kiosk_banner:b1', 'kiosk_banner:b2')
			});

		await reorderBanners(
			'SH1',
			SLOT,
			[
				{ id: 'kiosk_banner:b2', rev: '1-r2' },
				{ id: 'kiosk_banner:b1', rev: '1-r1' }
			],
			NOW
		);

		const { docs } = adminRawMock.mock.calls[1][2] as { docs: Record<string, unknown>[] };
		expect(docs).toHaveLength(2);
		for (const written of docs) {
			expect(written.template).toEqual(TEMPLATE);
			expect(written._attachments).toEqual({ image: STUB, template_image: LOGO_STUB });
		}
	});

	it('renumbers only its own group slot, leaving other groups and ungrouped banners alone', async () => {
		adminRawMock
			.mockResolvedValueOnce({
				status: 200,
				data: {
					docs: [
						doc(1),
						doc(2),
						doc(3, { _id: 'kiosk_banner:other', group_id: GROUP_B }),
						doc(4, { _id: 'kiosk_banner:v1', schema_v: 1, group_id: undefined })
					]
				}
			})
			.mockResolvedValueOnce({
				status: 201,
				data: rowsFor('kiosk_banner:b1', 'kiosk_banner:b2')
			});

		const records = await reorderBanners(
			'SH1',
			SLOT,
			[
				{ id: 'kiosk_banner:b2', rev: '1-r2' },
				{ id: 'kiosk_banner:b1', rev: '1-r1' }
			],
			NOW
		);

		const body = adminRawMock.mock.calls[1][2] as { docs: { _id: string }[] };
		expect(body.docs.map((d) => d._id)).toEqual(['kiosk_banner:b1', 'kiosk_banner:b2']);
		expect(records.map((r) => r._id)).toEqual(['kiosk_banner:b2', 'kiosk_banner:b1']);
	});

	it('writes nothing when the order is unchanged and returns the current list', async () => {
		adminRawMock.mockResolvedValueOnce({ status: 200, data: { docs: [doc(2), doc(1)] } });

		const records = await reorderBanners(
			'SH1',
			SLOT,
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
				SLOT,
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
		['an expired banner', [{ id: 'kiosk_banner:old', rev: '1-old' }]],
		['a banner of another group', [{ id: 'kiosk_banner:g', rev: '1-g' }]],
		['an ungrouped banner', [{ id: 'kiosk_banner:v1', rev: '1-v1' }]]
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
				SLOT,
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
				SLOT,
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
			return reorderBanners('SH1', SLOT, swap, NOW);
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
			SLOT,
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
			existingDoc({
				_id: `kiosk_banner:live-${String(n).padStart(2, '0')}`,
				order,
				group_id: GROUP_A
			});
		const docs = [
			...Array.from({ length: 22 }, (_, i) => live(i, 22 - i)),
			existingDoc({ _id: 'kiosk_banner:off', status: 'inactive', order: 0, group_id: GROUP_A }),
			existingDoc({
				_id: 'kiosk_banner:future',
				start_at: '2026-12-01T00:00:00.000Z',
				end_at: '2026-12-31T00:00:00.000Z',
				order: 0,
				group_id: GROUP_A
			}),
			existingDoc({
				_id: 'kiosk_banner:expired',
				start_at: '2026-01-01T00:00:00.000Z',
				end_at: '2026-02-01T00:00:00.000Z',
				order: 0,
				group_id: GROUP_A
			})
		];
		adminRawMock.mockResolvedValue({ status: 200, data: { docs } });

		const records = await listActiveForShelter('SH1', NOW, SLOT);

		expect(records).toHaveLength(20);
		expect(records.map((r) => r.order)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
		expect(records.some((r) => ['off', 'future', 'expired'].some((k) => r._id.endsWith(k)))).toBe(
			false
		);
	});
});

describe('listActiveForShelter by slot', () => {
	it('returns only the requested group and screen type, never an ungrouped banner', async () => {
		adminRawMock.mockResolvedValue({
			status: 200,
			data: {
				docs: [
					existingDoc({ _id: 'kiosk_banner:ungrouped', schema_v: 1, group_id: undefined }),
					existingDoc({ _id: 'kiosk_banner:a-c', group_id: GROUP_A, screen_type: 'compact' }),
					existingDoc({ _id: 'kiosk_banner:a-legacy', group_id: GROUP_A }),
					existingDoc({ _id: 'kiosk_banner:a-p', group_id: GROUP_A, screen_type: 'portrait' }),
					existingDoc({ _id: 'kiosk_banner:b-c', group_id: GROUP_B, screen_type: 'compact' })
				]
			}
		});

		const compact = await listActiveForShelter('SH1', NOW, SLOT);
		const portrait = await listActiveForShelter('SH1', NOW, {
			groupId: GROUP_A,
			screenType: 'portrait'
		});

		expect(compact.map((r) => r._id).sort()).toEqual(['kiosk_banner:a-c', 'kiosk_banner:a-legacy']);
		expect(portrait.map((r) => r._id)).toEqual(['kiosk_banner:a-p']);
	});

	it('applies the cap of 20 after filtering by slot', async () => {
		const docs = [
			...Array.from({ length: 5 }, (_, i) =>
				existingDoc({
					_id: `kiosk_banner:c-${i}`,
					order: 1,
					group_id: GROUP_A,
					screen_type: 'compact'
				})
			),
			...Array.from({ length: 22 }, (_, i) =>
				existingDoc({
					_id: `kiosk_banner:p-${String(i).padStart(2, '0')}`,
					order: 2 + i,
					group_id: GROUP_A,
					screen_type: 'portrait'
				})
			)
		];
		adminRawMock.mockResolvedValue({ status: 200, data: { docs } });

		const portrait = await listActiveForShelter('SH1', NOW, {
			groupId: GROUP_A,
			screenType: 'portrait'
		});

		expect(portrait).toHaveLength(20);
		expect(portrait.every((r) => r._id.startsWith('kiosk_banner:p-'))).toBe(true);
		expect(await listActiveForShelter('SH1', NOW, SLOT)).toHaveLength(5);
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

describe('getBannerTemplateImage', () => {
	it('decodes the template_image attachment fetched with attachments=true', async () => {
		adminRawMock.mockResolvedValue({
			status: 200,
			data: existingDoc({
				_attachments: {
					image: { content_type: 'image/png', data: pngBase64 },
					template_image: { content_type: 'image/jpeg', data: logoBase64 }
				}
			})
		});

		const logo = await getBannerTemplateImage('kiosk_banner:b1');

		expect(adminRawMock).toHaveBeenCalledWith(
			'/registry/kiosk_banner%3Ab1?attachments=true',
			'GET'
		);
		expect(logo?.contentType).toBe('image/jpeg');
		expect(Array.from(new Uint8Array(logo!.bytes))).toEqual([9, 8, 7]);
	});

	it('returns null when the doc is missing or has no template_image', async () => {
		adminRawMock.mockResolvedValueOnce({ status: 404, data: { error: 'not_found' } });
		expect(await getBannerTemplateImage('kiosk_banner:x')).toBeNull();

		adminRawMock.mockResolvedValueOnce({
			status: 200,
			data: existingDoc({ _attachments: { image: { content_type: 'image/png', data: pngBase64 } } })
		});
		expect(await getBannerTemplateImage('kiosk_banner:y')).toBeNull();
	});
});
