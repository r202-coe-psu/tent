import { describe, it, expect, beforeEach, vi } from 'vitest';
import { error } from '@sveltejs/kit';

// POST (provision a shelter) must accept the app `system_admin` role as well as
// Couch `_admin` — the system-management UI admits both via isSystemAdmin.
vi.mock('$lib/server/couch-admin', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/couch-admin')>();
	return {
		...actual,
		requireAdmin: vi.fn().mockRejectedValue(new Error('requireAdmin must not gate POST')),
		requireSystemAdmin: vi.fn(),
		requireShelterScopeOrSA: vi.fn()
	};
});
vi.mock('$lib/server/shelters.admin', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/shelters.admin')>();
	return { ...actual, listShelterMasters: vi.fn() };
});
vi.mock('$lib/features/shelters/server/provisioner', () => ({
	provisionShelter: vi.fn()
}));
vi.mock('$lib/server/master-data-server', () => ({
	readMasterDoc: vi.fn()
}));

import { GET, POST } from './+server';
import { requireShelterScopeOrSA, requireSystemAdmin } from '$lib/server/couch-admin';
import { listShelterMasters } from '$lib/server/shelters.admin';
import { provisionShelter } from '$lib/features/shelters/server/provisioner';
import { readMasterDoc } from '$lib/server/master-data-server';
import type { MasterData } from '$lib/features/master-data/domain';

const saMock = vi.mocked(requireSystemAdmin);
const provisionMock = vi.mocked(provisionShelter);
const readMasterDocMock = vi.mocked(readMasterDoc);

const siteKindDoc = {
	items: [
		{ code: 'evacuation_center', status: 'active' },
		{ code: 'host_house', status: 'active' },
		{ code: 'field_hospital', status: 'inactive' }
	]
} as unknown as MasterData;

const newShelter = {
	name: 'ศูนย์ทดสอบ',
	site_kind: 'host_house',
	capacity: 10,
	facilities: {},
	common_areas: {},
	utilities: {},
	risk: {},
	zones: []
};

function callPOST(body: unknown = {}) {
	const request = new Request('http://localhost/api/back-office/shelter', {
		method: 'POST',
		headers: { cookie: 'AuthSession=abc', 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	return POST({ request } as unknown as Parameters<typeof POST>[0]);
}

beforeEach(() => {
	saMock.mockReset().mockResolvedValue({
		name: 'sa',
		roles: ['system_admin'],
		isSA: true,
		shelterCode: null
	});
	provisionMock.mockReset();
	readMasterDocMock.mockReset().mockResolvedValue(siteKindDoc);
});

describe('POST /api/back-office/shelter', () => {
	it('authorizes via requireSystemAdmin so an app system_admin can provision', async () => {
		await callPOST({});
		expect(saMock).toHaveBeenCalledWith('AuthSession=abc');
	});

	it('rejects a non-admin caller with 403 before provisioning', async () => {
		saMock.mockImplementationOnce(async () => error(403, 'System admin privileges required'));
		await expect(callPOST({})).rejects.toMatchObject({ status: 403 });
		expect(provisionMock).not.toHaveBeenCalled();
	});
});

describe('POST /api/back-office/shelter — site_kind (CR-198 FR-7)', () => {
	it('provisions a shelter whose site_kind is an active master code', async () => {
		provisionMock.mockResolvedValue({} as never);
		const res = await callPOST(newShelter);
		expect(res.status).toBe(200);
		expect(readMasterDocMock).toHaveBeenCalledWith('site_kind');
		expect(provisionMock).toHaveBeenCalledTimes(1);
	});

	it.each(['field_hospital', 'not_in_master'])('rejects %s without provisioning', async (kind) => {
		const res = await callPOST({ ...newShelter, site_kind: kind });
		expect(res.status).toBe(422);
		expect((await res.json()).error.message).toContain('ประเภทศูนย์');
		expect(provisionMock).not.toHaveBeenCalled();
	});

	it('rejects every kind when the master doc does not exist', async () => {
		readMasterDocMock.mockResolvedValue(null);
		const res = await callPOST(newShelter);
		expect(res.status).toBe(422);
		expect(provisionMock).not.toHaveBeenCalled();
	});
});

describe('GET /api/back-office/shelter — visibility (#477)', () => {
	const masters = ['SH001', 'SH002', 'SH003'].map((code) => ({ code, name: code }));

	async function callGET(roles: string[], isSA = false) {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'u',
			roles,
			isSA,
			shelterCode: roles.find((r) => r.startsWith('shelter:'))?.slice(8) ?? null
		});
		vi.mocked(listShelterMasters).mockResolvedValue(masters as never);
		const request = new Request('http://localhost/api/back-office/shelter', {
			headers: { cookie: 'AuthSession=abc' }
		});
		const res = await GET({ request } as unknown as Parameters<typeof GET>[0]);
		return ((await res.json()) as { code: string }[]).map((s) => s.code);
	}

	it('returns every shelter a multi-shelter user holds, so they can switch', async () => {
		expect(await callGET(['shelter:SH001', 'shelter:SH002', 'SH002:shelter_manager'])).toEqual([
			'SH001',
			'SH002'
		]);
	});

	it('returns only the one shelter of a single-shelter user', async () => {
		expect(await callGET(['shelter:SH003', 'warehouse_staff'])).toEqual(['SH003']);
	});

	it('returns every shelter to a system admin', async () => {
		expect(await callGET(['system_admin'], true)).toEqual(['SH001', 'SH002', 'SH003']);
	});
});
