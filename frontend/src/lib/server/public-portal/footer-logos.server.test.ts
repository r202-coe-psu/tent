import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/server/couch-admin', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/couch-admin')>()),
	adminRaw: vi.fn(),
	adminAttachment: vi.fn()
}));

import { adminAttachment, adminRaw, ServiceError } from '$lib/server/couch-admin';
import type { FooterLogo } from '$lib/features/public-portal';
import {
	createFooterLogo,
	decodeFooterLogoFile,
	deleteFooterLogo,
	getFooterLogoImage,
	moveFooterLogoTo,
	preservedLogoFields,
	publicFooterLogos,
	setFooterLogoPublished,
	updateFooterLogo,
	type PublicPortalConfigRaw
} from './footer-logos.server';

const adminRawMock = vi.mocked(adminRaw);
const adminAttachmentMock = vi.mocked(adminAttachment);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const IMAGE = { bytes: PNG, contentType: 'image/png' } as const;
const INPUT = { alt_th: 'มอ.', alt_en: 'PSU', link_url: '', is_published: true };

const logo = (id: string, order: number, is_published = true): FooterLogo => ({
	id,
	order,
	is_published,
	alt_th: `โลโก้ ${id}`,
	alt_en: '',
	link_url: ''
});

const stub = (digest: string) => ({ stub: true as const, content_type: 'image/png', digest });

function configDoc(extra: Partial<PublicPortalConfigRaw> = {}): PublicPortalConfigRaw {
	return {
		_id: 'config:public_portal',
		_rev: '3-a',
		type: 'config',
		schema_v: 1,
		created_at: '2026-10-01T00:00:00.000Z',
		created_by: 'seed',
		faqs: { public: [{ id: 'f1', question: 'q', answer: 'a', order: 0, is_published: true }] },
		line_oa_url: 'https://line.me/x',
		footer_logos: [logo('a', 1), logo('b', 2)],
		_attachments: { footer_logo_a: stub('md5-a'), footer_logo_b: stub('md5-b') },
		...extra
	};
}

/** The doc body of the PUT the mutation sent. */
function putBody(): Record<string, unknown> & {
	footer_logos: FooterLogo[];
	_attachments: Record<string, unknown>;
} {
	const put = adminRawMock.mock.calls.find(([, method]) => method === 'PUT');
	if (!put) throw new Error('no PUT sent');
	return put[2] as never;
}

function givenDoc(doc: PublicPortalConfigRaw | null, putStatus = 201) {
	adminRawMock
		.mockResolvedValueOnce(doc ? { status: 200, data: doc } : { status: 404, data: null })
		.mockResolvedValueOnce({ status: putStatus, data: { ok: true, rev: '4-b' } });
}

beforeEach(() => {
	adminRawMock.mockReset();
	adminAttachmentMock.mockReset();
});

describe('createFooterLogo', () => {
	it('appends the logo and its inline image while keeping FAQ, social and other stubs', async () => {
		givenDoc(configDoc());

		await createFooterLogo('sa', '3-a', INPUT, IMAGE);

		const body = putBody();
		expect(body._rev).toBe('3-a');
		expect(body.faqs).toEqual(configDoc().faqs);
		expect(body.line_oa_url).toBe('https://line.me/x');
		expect(body.footer_logos).toHaveLength(3);
		const added = body.footer_logos[2];
		expect(added).toMatchObject({ ...INPUT, order: 3 });
		expect(body._attachments).toMatchObject({
			footer_logo_a: stub('md5-a'),
			footer_logo_b: stub('md5-b'),
			[`footer_logo_${added.id}`]: {
				content_type: 'image/png',
				data: Buffer.from(PNG).toString('base64')
			}
		});
	});

	it('creates the config doc from the FAQ defaults when it does not exist yet', async () => {
		givenDoc(null);

		await createFooterLogo('sa', '', INPUT, IMAGE);

		const body = putBody();
		expect(body).not.toHaveProperty('_rev');
		expect(body).toMatchObject({ _id: 'config:public_portal', schema_v: 1, created_by: 'sa' });
		expect(Object.keys(body.faqs as object)).toContain('public');
		expect(body.footer_logos).toHaveLength(1);
	});

	it('rejects a 13th logo without writing', async () => {
		const full = Array.from({ length: 12 }, (_, i) => logo(`l${i}`, i + 1));
		givenDoc(configDoc({ footer_logos: full }));

		await expect(createFooterLogo('sa', '3-a', INPUT, IMAGE)).rejects.toMatchObject({
			code: 'VALIDATION'
		});
		expect(adminRawMock).toHaveBeenCalledTimes(1);
	});

	it('maps a stale _rev (409) to CONFLICT', async () => {
		givenDoc(configDoc(), 409);

		await expect(createFooterLogo('sa', '2-old', INPUT, IMAGE)).rejects.toMatchObject({
			code: 'CONFLICT'
		});
	});
});

describe('updateFooterLogo', () => {
	it('keeps the existing image stub when no new image is given', async () => {
		givenDoc(configDoc());

		await updateFooterLogo('sa', '3-a', 'a', { ...INPUT, alt_th: 'แก้' }, null);

		const body = putBody();
		expect(body.footer_logos[0]).toMatchObject({ id: 'a', alt_th: 'แก้', order: 1 });
		expect(body._attachments.footer_logo_a).toEqual(stub('md5-a'));
	});

	it('replaces the image when a new one is given', async () => {
		givenDoc(configDoc());

		await updateFooterLogo('sa', '3-a', 'a', INPUT, IMAGE);

		expect(putBody()._attachments.footer_logo_a).toMatchObject({ content_type: 'image/png' });
	});

	it('fails for an unknown id', async () => {
		givenDoc(configDoc());

		await expect(updateFooterLogo('sa', '3-a', 'x', INPUT, null)).rejects.toBeInstanceOf(
			ServiceError
		);
	});
});

describe('deleteFooterLogo', () => {
	it('drops the entry and its attachment in the same PUT and renumbers', async () => {
		givenDoc(configDoc());

		await deleteFooterLogo('sa', '3-a', 'a');

		const body = putBody();
		expect(body.footer_logos).toEqual([{ ...logo('b', 2), order: 1 }]);
		expect(body._attachments).toEqual({ footer_logo_b: stub('md5-b') });
	});
});

describe('moveFooterLogoTo / setFooterLogoPublished', () => {
	it('moves a logo up', async () => {
		givenDoc(configDoc());

		await moveFooterLogoTo('sa', '3-a', 'b', 'up');

		expect(putBody().footer_logos.map((l) => [l.id, l.order])).toEqual([
			['b', 1],
			['a', 2]
		]);
	});

	it('hides a logo', async () => {
		givenDoc(configDoc());

		await setFooterLogoPublished('sa', '3-a', 'a', false);

		expect(putBody().footer_logos[0]).toMatchObject({ id: 'a', is_published: false });
	});
});

describe('preservedLogoFields', () => {
	it('returns footer_logos and _attachments of the stored doc only', () => {
		const doc = configDoc();
		expect(preservedLogoFields(doc)).toEqual({
			footer_logos: doc.footer_logos,
			_attachments: doc._attachments
		});
		expect(preservedLogoFields(null)).toEqual({});
		expect(
			preservedLogoFields(configDoc({ footer_logos: undefined, _attachments: undefined }))
		).toEqual({});
	});
});

describe('publicFooterLogos', () => {
	it('lists published logos with an image, in order, with digest URLs', () => {
		const doc = configDoc({
			footer_logos: [logo('a', 2), logo('b', 1), logo('c', 3, false), logo('d', 4)],
			_attachments: { footer_logo_a: stub('md5-a'), footer_logo_b: stub('md5-b') }
		});

		expect(publicFooterLogos(doc)).toEqual([
			{
				id: 'b',
				alt_th: 'โลโก้ b',
				alt_en: '',
				link_url: '',
				image_url: '/api/public/v1/config/footer-logos/b/image?v=md5-b'
			},
			{
				id: 'a',
				alt_th: 'โลโก้ a',
				alt_en: '',
				link_url: '',
				image_url: '/api/public/v1/config/footer-logos/a/image?v=md5-a'
			}
		]);
	});
});

describe('decodeFooterLogoFile', () => {
	it('accepts a PNG by magic bytes regardless of the declared type', async () => {
		const file = new File([PNG], 'logo.bin', { type: 'application/octet-stream' });
		await expect(decodeFooterLogoFile(file)).resolves.toMatchObject({ contentType: 'image/png' });
	});

	it('rejects non-images, SVG and empty files', async () => {
		const svg = new File(['<svg onload="alert(1)"/>'], 'logo.png', { type: 'image/png' });
		await expect(decodeFooterLogoFile(svg)).rejects.toMatchObject({ code: 'VALIDATION' });
		await expect(decodeFooterLogoFile(new File([], 'x.png'))).rejects.toMatchObject({
			code: 'VALIDATION'
		});
		await expect(decodeFooterLogoFile('nope')).rejects.toMatchObject({ code: 'VALIDATION' });
	});

	it('rejects files over 512 KB — the logo cap, not the 2 MB banner cap (CR-184 Q1)', async () => {
		const big = new Uint8Array(512 * 1024 + 1);
		big.set(PNG);
		await expect(decodeFooterLogoFile(new File([big], 'big.png'))).rejects.toMatchObject({
			code: 'VALIDATION',
			message: 'รูปภาพต้องมีขนาดไม่เกิน 512 KB'
		});
	});

	it('accepts a PNG of exactly 512 KB', async () => {
		const edge = new Uint8Array(512 * 1024);
		edge.set(PNG);
		await expect(decodeFooterLogoFile(new File([edge], 'edge.png'))).resolves.toMatchObject({
			contentType: 'image/png'
		});
	});
});

describe('getFooterLogoImage', () => {
	const bytes = PNG.buffer;

	it('returns the attachment bytes of a published logo', async () => {
		adminRawMock.mockResolvedValueOnce({ status: 200, data: configDoc() });
		adminAttachmentMock.mockResolvedValueOnce({ status: 200, bytes, contentType: 'image/png' });

		await expect(getFooterLogoImage('a')).resolves.toEqual({ bytes, contentType: 'image/png' });
		expect(adminAttachmentMock).toHaveBeenCalledWith(
			'/registry/config:public_portal/footer_logo_a'
		);
	});

	it('hides unpublished logos unless includeUnpublished', async () => {
		const doc = configDoc({ footer_logos: [logo('a', 1, false)] });
		adminRawMock.mockResolvedValue({ status: 200, data: doc });
		adminAttachmentMock.mockResolvedValue({ status: 200, bytes, contentType: 'image/png' });

		await expect(getFooterLogoImage('a')).resolves.toBeNull();
		expect(adminAttachmentMock).not.toHaveBeenCalled();
		await expect(getFooterLogoImage('a', { includeUnpublished: true })).resolves.not.toBeNull();
	});

	it('returns null for unknown ids and missing attachments', async () => {
		adminRawMock.mockResolvedValue({ status: 200, data: configDoc() });
		adminAttachmentMock.mockResolvedValueOnce({ status: 404, bytes: null, contentType: null });

		await expect(getFooterLogoImage('x')).resolves.toBeNull();
		await expect(getFooterLogoImage('a')).resolves.toBeNull();
	});
});
