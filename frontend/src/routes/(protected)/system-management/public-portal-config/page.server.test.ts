import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/couch-admin', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/couch-admin')>()),
	adminRaw: vi.fn(),
	authorizeUserWrite: vi.fn()
}));

import { actions } from './+page.server';
import { adminRaw, authorizeUserWrite } from '$lib/server/couch-admin';
import { DEFAULT_PUBLIC_PORTAL_CONFIG } from '$lib/features/public-portal';

const mockAdminRaw = vi.mocked(adminRaw);
const mockAuthorize = vi.mocked(authorizeUserWrite);

const SA = { name: 'sa', roles: ['system_admin'], isSA: true, shelterCode: null };
type ActionEvent = Parameters<(typeof actions)['save']>[0];

function formRequest(action: string, form: FormData): ActionEvent {
	const request = new Request(`http://localhost/?/${action}`, { method: 'POST', body: form });
	return { request } as unknown as ActionEvent;
}

beforeEach(() => {
	mockAdminRaw.mockReset();
	mockAuthorize.mockReset();
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
