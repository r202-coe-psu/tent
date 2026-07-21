import { describe, it, expect, beforeEach, vi } from 'vitest';
import { error } from '@sveltejs/kit';

// Partial mock: keep the real ServiceError / serviceError contract helpers,
// stub only the CouchDB-touching auth guard. Reads are open to any authenticated
// user (CR-012 §2), so the GET route gates on requireShelterScopeOrSA.
const caller = {
	name: 'mgr',
	roles: ['shelter:SH001', 'shelter_manager'],
	isSA: false,
	shelterCode: 'SH001'
};
vi.mock('$lib/server/couch-admin', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/couch-admin')>();
	return { ...actual, requireShelterScopeOrSA: vi.fn() };
});
vi.mock('$lib/server/master-data-server', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/master-data-server')>()),
	readMasterDoc: vi.fn()
}));

import { GET } from './+server';
import { requireShelterScopeOrSA } from '$lib/server/couch-admin';
import { readMasterDoc } from '$lib/server/master-data-server';
import { MASTER_DATA_TYPES, type MasterData } from '$lib/features/master-data/domain';

const authMock = vi.mocked(requireShelterScopeOrSA);
const readMock = vi.mocked(readMasterDoc);

function call(cookie: string | null = 'AuthSession=abc') {
	const request = new Request('http://localhost/api/back-office/master-data', {
		headers: cookie ? { cookie } : {}
	});
	return GET({ request, params: {} } as unknown as Parameters<typeof GET>[0]);
}

function callScoped() {
	const request = new Request(
		'http://localhost/api/back-office/master-data?scope=shelter&shelter_code=SH001',
		{ headers: { cookie: 'AuthSession=abc' } }
	);
	return GET({ request, params: {} } as unknown as Parameters<typeof GET>[0]);
}

function callEffective() {
	const request = new Request(
		'http://localhost/api/back-office/master-data?scope=effective&shelter_code=SH001',
		{ headers: { cookie: 'AuthSession=abc' } }
	);
	return GET({ request, params: {} } as unknown as Parameters<typeof GET>[0]);
}

function fakeDoc(type: MasterData['master_type'], items: MasterData['items']): MasterData {
	return {
		_id: `master_data:${type}`,
		_rev: '1-a',
		type: 'master_data',
		schema_v: 1,
		master_type: type,
		items,
		created_at: '2026-01-01T00:00:00.000Z',
		updated_at: '2026-01-01T00:00:00.000Z',
		created_by: 'sa-bootstrap'
	};
}

describe('GET /api/back-office/master-data', () => {
	beforeEach(() => {
		authMock.mockReset().mockResolvedValue(caller);
		readMock.mockReset();
	});

	it('returns one placeholder entry per master type when no docs exist', async () => {
		readMock.mockResolvedValue(null);

		const res = await call();
		const body = (await res.json()) as Array<{
			_id: string;
			master_type: string;
			items: unknown[];
		}>;

		expect(res.status).toBe(200);
		expect(body).toHaveLength(MASTER_DATA_TYPES.length);
		for (const type of MASTER_DATA_TYPES) {
			const entry = body.find((e) => e.master_type === type);
			expect(entry).toBeDefined();
			expect(entry?._id).toBe(`master_data:${type}`);
			expect(entry?.items).toEqual([]);
		}
	});

	it('surfaces items from an existing doc and empty [] for the rest', async () => {
		readMock.mockImplementation(async (type) =>
			type === 'pet_types'
				? fakeDoc('pet_types', [
						{ code: 'dog', label: 'Dog', is_default: true },
						{ code: 'cat', label: 'Cat', is_default: false }
					])
				: null
		);

		const res = await call();
		const body = (await res.json()) as Array<{ master_type: string; items: unknown[] }>;

		expect(body.find((e) => e.master_type === 'pet_types')?.items).toHaveLength(2);
		expect(body.find((e) => e.master_type === 'vulnerable_group')?.items).toEqual([]);
	});

	it('forwards the request cookie to the auth guard', async () => {
		readMock.mockResolvedValue(null);
		await call('AuthSession=xyz');
		expect(authMock).toHaveBeenCalledWith('AuthSession=xyz');
	});

	it('propagates the guard rejection (401/403) instead of swallowing it', async () => {
		authMock.mockImplementationOnce(() => {
			throw error(403, 'Admin privileges required');
		});
		const err = await Promise.resolve(call()).catch((e: unknown) => e);
		expect((err as { status?: number }).status).toBe(403);
	});

	it('reads shelter-local docs without falling back to global docs', async () => {
		readMock.mockImplementation(async (type, shelterCode) =>
			type === 'pet_types' && shelterCode === 'SH001'
				? {
						...fakeDoc('pet_types', [{ code: 'cat', label: 'Cat', is_default: true }]),
						_id: 'master_data:pet_types:SH001',
						shelter_code: 'SH001',
						schema_v: 2
					}
				: null
		);

		const res = await callScoped();
		const body = (await res.json()) as Array<{
			_id: string;
			master_type: string;
			items: unknown[];
			scope: string;
			shelter_code: string | null;
		}>;

		expect(authMock).toHaveBeenCalledWith('AuthSession=abc', 'SH001');
		expect(body.find((entry) => entry.master_type === 'pet_types')).toMatchObject({
			_id: 'master_data:pet_types:SH001',
			items: [{ code: 'cat', label: 'Cat', is_default: true }],
			scope: 'shelter',
			shelter_code: 'SH001'
		});
		expect(body.find((entry) => entry.master_type === 'vulnerable_group')?._id).toBe(
			'master_data:vulnerable_group:SH001'
		);
	});

	it('falls back to the global doc for an effective shelter read', async () => {
		readMock.mockImplementation(async (type, shelterCode) =>
			type === 'pet_types' && !shelterCode
				? fakeDoc('pet_types', [{ code: 'dog', label: 'Dog', is_default: true }])
				: null
		);

		const res = await callEffective();
		const body = (await res.json()) as Array<{
			master_type: string;
			items: unknown[];
			scope: string;
			shelter_code: string | null;
			item_sources: Record<string, { scope: string }>;
		}>;

		expect(body.find((entry) => entry.master_type === 'pet_types')).toMatchObject({
			items: [{ code: 'dog', label: 'Dog', is_default: true }],
			scope: 'effective',
			shelter_code: 'SH001',
			item_sources: { dog: { scope: 'global' } }
		});
	});
});
