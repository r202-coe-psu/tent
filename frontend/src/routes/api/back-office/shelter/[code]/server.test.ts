import { describe, it, expect, beforeEach, vi } from 'vitest';
import { error } from '@sveltejs/kit';

// PATCH (edit one shelter) must authorize with requireShelterManagerOrSA so a
// shelter_manager can edit their OWN shelter (scope-enforced), not requireAdmin.
const caller = {
	name: 'mgr',
	roles: ['shelter:SH001', 'shelter_manager'],
	isSA: false,
	shelterCode: 'SH001'
};

vi.mock('$lib/server/couch-admin', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/couch-admin')>();
	const c = {
		name: 'mgr',
		roles: ['shelter:SH001', 'shelter_manager'],
		isSA: false,
		shelterCode: 'SH001'
	};
	return {
		...actual,
		requireShelterManagerOrSA: vi.fn().mockResolvedValue(c),
		requireShelterScopeOrSA: vi.fn().mockResolvedValue(c)
	};
});
vi.mock('$lib/server/shelters.admin', () => ({
	updateMaster: vi.fn().mockResolvedValue({ id: 'shelter:SH001', rev: '2-new' }),
	findMasterByCode: vi.fn(),
	migrate: vi.fn(),
	nowIso: () => '2026-01-01T00:00:00.000Z'
}));

import { PATCH } from './+server';
import { requireShelterManagerOrSA } from '$lib/server/couch-admin';
import { updateMaster } from '$lib/server/shelters.admin';

const mgrMock = vi.mocked(requireShelterManagerOrSA);
const updateMock = vi.mocked(updateMaster);

function callPATCH(code: string, body: unknown = {}) {
	const request = new Request(`http://localhost/api/back-office/shelter/${code}`, {
		method: 'PATCH',
		headers: { cookie: 'AuthSession=abc', 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	return PATCH({ request, params: { code } } as unknown as Parameters<typeof PATCH>[0]);
}

beforeEach(() => {
	mgrMock.mockReset().mockResolvedValue(caller);
	updateMock.mockReset().mockResolvedValue({ id: 'shelter:SH001', rev: '2-new' });
});

describe('PATCH /api/back-office/shelter/[code]', () => {
	it('authorizes via requireShelterManagerOrSA (SM edits own shelter) then updates', async () => {
		const res = await callPATCH('SH001', {});
		expect(mgrMock).toHaveBeenCalledWith('AuthSession=abc', 'SH001');
		expect(updateMock).toHaveBeenCalledTimes(1);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, code: 'SH001' });
	});

	it('does not update when the scope guard rejects a cross-shelter edit', async () => {
		mgrMock.mockImplementationOnce(() => {
			throw error(403, 'not authorised for shelter');
		});
		await callPATCH('SH999', {});
		expect(updateMock).not.toHaveBeenCalled();
	});
});
