import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/couch-admin', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/couch-admin')>()),
	authorizeUserWrite: vi.fn()
}));
vi.mock('$lib/server/public-portal/footer-logos.server', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/public-portal/footer-logos.server')>()),
	readPublicPortalConfig: vi.fn(),
	createFooterLogo: vi.fn(),
	deleteFooterLogo: vi.fn()
}));

import { actions, load } from './+page.server';
import { authorizeUserWrite, ServiceError } from '$lib/server/couch-admin';
import {
	createFooterLogo,
	deleteFooterLogo,
	readPublicPortalConfig
} from '$lib/server/public-portal/footer-logos.server';

const mockAuthorize = vi.mocked(authorizeUserWrite);
const mockCreate = vi.mocked(createFooterLogo);
const mockDelete = vi.mocked(deleteFooterLogo);
const mockRead = vi.mocked(readPublicPortalConfig);

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
	mockAuthorize.mockReset();
	mockCreate.mockReset();
	mockDelete.mockReset();
	mockRead.mockReset();
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

describe('load', () => {
	const loadEvent = () =>
		({ request: new Request('http://localhost/') }) as unknown as Parameters<typeof load>[0];

	it('rejects a shelter manager with 403 and never reads the config (SA-only, FR-7)', async () => {
		mockAuthorize.mockResolvedValue(MANAGER as never);

		await expect(load(loadEvent())).rejects.toMatchObject({ status: 403 });
		expect(mockRead).not.toHaveBeenCalled();
	});

	it('maps UNAUTHENTICATED to 401', async () => {
		mockAuthorize.mockRejectedValue(new ServiceError('UNAUTHENTICATED', 'no session'));

		await expect(load(loadEvent())).rejects.toMatchObject({ status: 401 });
	});

	it('returns the logos and rev for a System Admin', async () => {
		mockAuthorize.mockResolvedValue(SA as never);
		mockRead.mockResolvedValue({ _rev: '3-a', footer_logos: [] } as never);

		await expect(load(loadEvent())).resolves.toMatchObject({
			footerLogos: [],
			configRev: '3-a',
			canEditLogos: true
		});
	});
});
