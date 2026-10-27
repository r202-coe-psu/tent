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
vi.mock('$lib/server/master-data-server', () => ({
	readMasterDoc: vi.fn()
}));
vi.mock('$lib/server/shelters.admin', () => ({
	updateMaster: vi.fn().mockResolvedValue({ id: 'shelter:SH001', rev: '2-new' }),
	findMasterByCode: vi.fn(),
	migrate: vi.fn(),
	nowIso: () => '2026-01-01T00:00:00.000Z'
}));

import { PATCH } from './+server';
import { requireShelterManagerOrSA } from '$lib/server/couch-admin';
import { updateMaster } from '$lib/server/shelters.admin';
import { readMasterDoc } from '$lib/server/master-data-server';
import type { MasterData } from '$lib/features/master-data/domain';
import type { ShelterMaster } from '$lib/features/shelters/server';

const mgrMock = vi.mocked(requireShelterManagerOrSA);
const updateMock = vi.mocked(updateMaster);
const readMasterDocMock = vi.mocked(readMasterDoc);

const siteKindDoc = {
	items: [
		{ code: 'evacuation_center', status: 'active' },
		{ code: 'host_house', status: 'active' },
		{ code: 'field_hospital', status: 'inactive' }
	]
} as unknown as MasterData;

/** Run the mutator updateMaster is given against a stored shelter of `storedKind`. */
function useStoredKind(storedKind: string) {
	updateMock.mockImplementation(async (_code, mutator) => {
		await mutator({ site_kind: storedKind } as ShelterMaster);
		return { id: 'shelter:SH001', rev: '2-new' };
	});
}

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
	readMasterDocMock.mockReset().mockResolvedValue(siteKindDoc);
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

describe('PATCH /api/back-office/shelter/[code] — site_kind (CR-198 FR-7/FR-8)', () => {
	it('does not read the master when the body carries no site_kind', async () => {
		useStoredKind('field_hospital');
		const res = await callPATCH('SH001', { name: 'ชื่อใหม่' });
		expect(res.status).toBe(200);
		expect(readMasterDocMock).not.toHaveBeenCalled();
	});

	it('accepts a change to an active kind', async () => {
		useStoredKind('evacuation_center');
		const res = await callPATCH('SH001', { site_kind: 'host_house' });
		expect(res.status).toBe(200);
		expect(readMasterDocMock).toHaveBeenCalledWith('site_kind');
	});

	it('accepts an unchanged kind whose item was deactivated (FR-8)', async () => {
		useStoredKind('field_hospital');
		const res = await callPATCH('SH001', { site_kind: 'field_hospital' });
		expect(res.status).toBe(200);
	});

	it.each(['field_hospital', 'not_in_master'])(
		'rejects a change to %s with the field named',
		async (kind) => {
			useStoredKind('evacuation_center');
			const res = await callPATCH('SH001', { site_kind: kind });
			expect(res.status).toBe(422);
			expect((await res.json()).error.message).toContain('ประเภทศูนย์');
		}
	);
});
