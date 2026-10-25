import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/couch-admin', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/couch-admin')>()),
	adminRaw: vi.fn(),
	authorizeUserWrite: vi.fn()
}));
vi.mock('$lib/server/public-portal/footer-logos.server', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/public-portal/footer-logos.server')>()),
	createFooterLogo: vi.fn(),
	deleteFooterLogo: vi.fn()
}));

import { actions } from './+page.server';
import { adminRaw, authorizeUserWrite, ServiceError } from '$lib/server/couch-admin';
import { createFooterLogo, deleteFooterLogo } from '$lib/server/public-portal/footer-logos.server';
import { DEFAULT_PUBLIC_PORTAL_CONFIG } from '$lib/features/public-portal';

const mockAdminRaw = vi.mocked(adminRaw);
const mockAuthorize = vi.mocked(authorizeUserWrite);
const mockCreate = vi.mocked(createFooterLogo);
const mockDelete = vi.mocked(deleteFooterLogo);

const SA = { name: 'sa', roles: ['system_admin'], isSA: true, shelterCode: null };
const MANAGER = { name: 'mgr', roles: ['S1:shelter_manager'], isSA: false, shelterCode: 'S1' };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

type ActionEvent = Parameters<(typeof actions)['createLogo']>[0];

function formRequest(action: string, form: FormData): ActionEvent {
	const request = new Request(`http://localhost/?/${action}`, { method: 'POST', body: form });
	return { request } as unknown as ActionEvent;
}

function logoForm(extra: Record<string, string | File> = {}): FormData {
	const form = new FormData();
	form.set('rev', '3-a');
	form.set('alt_th', 'มอ.');
	form.set('is_published', 'true');
	for (const [key, value] of Object.entries(extra)) form.set(key, value);
	return form;
}

beforeEach(() => {
	mockAdminRaw.mockReset();
	mockAuthorize.mockReset();
	mockCreate.mockReset();
	mockDelete.mockReset();
});

describe('footer logo actions', () => {
	it('reject a shelter manager with 403 and never write (FR-7)', async () => {
		mockAuthorize.mockResolvedValue(MANAGER as never);

		const result = await actions.deleteLogo(formRequest('deleteLogo', logoForm({ id: 'a' })));

		expect(result).toMatchObject({ status: 403 });
		expect(mockDelete).not.toHaveBeenCalled();
	});

	it('createLogo decodes the file and passes the parsed input', async () => {
		mockAuthorize.mockResolvedValue(SA as never);
		const image = new File([PNG], 'psu.png', { type: 'image/png' });

		const result = await actions.createLogo(formRequest('createLogo', logoForm({ image })));

		expect(result).toEqual({ logoMessage: 'เพิ่มโลโก้เรียบร้อยแล้ว' });
		expect(mockCreate).toHaveBeenCalledWith(
			'sa',
			'3-a',
			{ alt_th: 'มอ.', alt_en: '', link_url: '', is_published: true },
			expect.objectContaining({ contentType: 'image/png' })
		);
	});

	it('createLogo without an image is 422', async () => {
		mockAuthorize.mockResolvedValue(SA as never);

		const result = await actions.createLogo(formRequest('createLogo', logoForm()));

		expect(result).toMatchObject({ status: 422, data: { logoError: 'กรุณาเลือกรูปโลโก้' } });
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('maps CONFLICT to 409', async () => {
		mockAuthorize.mockResolvedValue(SA as never);
		mockDelete.mockRejectedValueOnce(new ServiceError('CONFLICT', 'stale'));

		const result = await actions.deleteLogo(formRequest('deleteLogo', logoForm({ id: 'a' })));

		expect(result).toMatchObject({ status: 409, data: { logoError: 'stale' } });
	});
});

describe('save (FAQ/social)', () => {
	it('keeps footer_logos and _attachments of the stored doc (FR-10)', async () => {
		mockAuthorize.mockResolvedValue(SA as never);
		const stored = {
			_id: 'config:public_portal',
			_rev: '3-a',
			type: 'config',
			schema_v: 1,
			created_at: '2026-10-01T00:00:00.000Z',
			created_by: 'seed',
			...DEFAULT_PUBLIC_PORTAL_CONFIG,
			footer_logos: [{ id: 'a', alt_th: 'มอ.', order: 1, is_published: true }],
			_attachments: { footer_logo_a: { stub: true, content_type: 'image/png', digest: 'md5-a' } }
		};
		mockAdminRaw
			.mockResolvedValueOnce({ status: 200, data: stored })
			.mockResolvedValueOnce({ status: 201, data: { ok: true } });

		// A crafted body must not be able to overwrite logos through the FAQ form.
		const body = { ...DEFAULT_PUBLIC_PORTAL_CONFIG, footer_logos: [], line_oa_url: '' };
		const form = new FormData();
		form.set('__superform_json', JSON.stringify([body]));
		form.set('__superform_id', 'publicConfigForm');

		await actions.save(formRequest('save', form) as never);

		const put = mockAdminRaw.mock.calls.find(([, method]) => method === 'PUT');
		expect(put?.[2]).toMatchObject({
			_rev: '3-a',
			footer_logos: stored.footer_logos,
			_attachments: stored._attachments
		});
	});

	it('does not write when the stored doc cannot be read, so logos are never dropped', async () => {
		mockAuthorize.mockResolvedValue(SA as never);
		mockAdminRaw.mockResolvedValueOnce({ status: 500, data: { error: 'internal' } });
		const form = new FormData();
		form.set('__superform_json', JSON.stringify([DEFAULT_PUBLIC_PORTAL_CONFIG]));
		form.set('__superform_id', 'publicConfigForm');

		const result = await actions.save(formRequest('save', form) as never);

		expect(mockAdminRaw.mock.calls.some(([, method]) => method === 'PUT')).toBe(false);
		expect(result).toMatchObject({ status: 500 });
	});
});
