import { describe, it, expect, beforeEach, vi } from 'vitest';
import { error } from '@sveltejs/kit';

// GET and shelter-scoped writes use requireShelterScopeOrSA; global writes stay
// SA-only (requireAdmin).
const caller = {
	name: 'mgr',
	roles: ['shelter:SH001', 'shelter_manager'],
	isSA: false,
	shelterCode: 'SH001'
};
vi.mock('$lib/server/couch-admin', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/couch-admin')>();
	return {
		...actual,
		requireAdmin: vi.fn().mockResolvedValue(undefined),
		requireShelterScopeOrSA: vi.fn().mockResolvedValue({
			name: 'mgr',
			roles: ['shelter:SH001', 'shelter_manager'],
			isSA: false,
			shelterCode: 'SH001'
		}),
		adminRaw: vi.fn()
	};
});
vi.mock('$lib/server/master-data-server', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/master-data-server')>()),
	readMasterDoc: vi.fn()
}));

import { GET, PUT } from './+server';
import { requireAdmin, requireShelterScopeOrSA, adminRaw } from '$lib/server/couch-admin';
import { readMasterDoc } from '$lib/server/master-data-server';
import type { MasterData } from '$lib/features/master-data/domain';

const requireAdminMock = vi.mocked(requireAdmin);
const authMock = vi.mocked(requireShelterScopeOrSA);
const adminRawMock = vi.mocked(adminRaw);
const readMock = vi.mocked(readMasterDoc);

function existingDoc(items: MasterData['items']): MasterData {
	return {
		_id: 'master_data:pet_types',
		_rev: '3-old',
		type: 'master_data',
		schema_v: 1,
		master_type: 'pet_types',
		items,
		created_at: '2026-01-01T00:00:00.000Z',
		updated_at: '2026-01-02T00:00:00.000Z',
		created_by: 'origauthor'
	};
}

function callGET(type: string, query = '') {
	const request = new Request(`http://localhost/api/back-office/master-data/${type}${query}`, {
		headers: { cookie: 'AuthSession=abc' }
	});
	return GET({ request, params: { type } } as unknown as Parameters<typeof GET>[0]);
}

function callPUT(type: string, body: unknown, query = '') {
	const request = new Request(`http://localhost/api/back-office/master-data/${type}${query}`, {
		method: 'PUT',
		headers: { cookie: 'AuthSession=abc', 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	return PUT({ request, params: { type } } as unknown as Parameters<typeof PUT>[0]);
}

/** The doc written to CouchDB — third arg of the adminRaw PUT call. */
function writtenDoc(): MasterData {
	return adminRawMock.mock.calls[0][2] as MasterData;
}

beforeEach(() => {
	requireAdminMock.mockReset().mockResolvedValue('sa-user');
	authMock.mockReset().mockResolvedValue(caller);
	adminRawMock.mockReset().mockResolvedValue({ status: 201, data: { rev: '4-new' } });
	readMock.mockReset();
});

describe('GET /api/back-office/master-data/[type]', () => {
	it('returns the doc items for a valid type', async () => {
		readMock.mockResolvedValue(existingDoc([{ code: 'dog', label: 'Dog', is_default: true }]));

		const res = await callGET('pet_types');
		const body = (await res.json()) as { master_type: string; items: unknown[] };

		expect(res.status).toBe(200);
		expect(body.master_type).toBe('pet_types');
		expect(body.items).toHaveLength(1);
	});

	it('returns an empty placeholder when the doc does not exist yet', async () => {
		readMock.mockResolvedValue(null);
		const res = await callGET('pet_types');
		expect((await res.json()).items).toEqual([]);
	});

	it('resolves a shelter-local document before the global document', async () => {
		readMock.mockImplementation(async (_type, shelterCode) =>
			shelterCode === 'SH001'
				? {
						...existingDoc([{ code: 'cat', label: 'Cat', is_default: true }]),
						_id: 'master_data:pet_types:SH001',
						shelter_code: 'SH001',
						schema_v: 2
					}
				: { ...existingDoc([{ code: 'dog', label: 'Dog', is_default: true }]) }
		);

		const res = await callGET('pet_types', '?scope=effective&shelter_code=SH001');
		const body = (await res.json()) as {
			items: unknown[];
			item_sources: Record<string, { scope: string; shelter_code?: string | null }>;
		};
		expect(body.items).toEqual([
			{ code: 'dog', label: 'Dog', is_default: true },
			{ code: 'cat', label: 'Cat', is_default: true }
		]);
		expect(body.item_sources).toEqual({
			dog: { scope: 'global', shelter_code: null },
			cat: { scope: 'shelter', shelter_code: 'SH001' }
		});
		expect(readMock).toHaveBeenCalledWith('pet_types', 'SH001');
	});

	it('rejects an unknown master type via the contract envelope', async () => {
		const res = await callGET('not_a_type');
		expect(res.status).toBe(500);
		expect((await res.json()).error.code).toBe('INTERNAL');
	});

	it('propagates the auth guard rejection', async () => {
		authMock.mockImplementationOnce(() => {
			throw error(401, 'Authentication required');
		});
		const err = await Promise.resolve(callGET('pet_types')).catch((e: unknown) => e);
		expect((err as { status?: number }).status).toBe(401);
	});
});

describe('PUT /api/back-office/master-data/[type]', () => {
	const items = [{ code: 'dog', label: 'Dog', is_default: false }];

	it('rejects a body without an items array (422 VALIDATION)', async () => {
		const res = await callPUT('pet_types', { nope: true });
		expect(res.status).toBe(422);
		expect((await res.json()).error.code).toBe('VALIDATION');
		expect(adminRawMock).not.toHaveBeenCalled();
	});

	it('creates a fresh envelope stamped with the authenticated SA name when absent', async () => {
		readMock.mockResolvedValue(null);

		const res = await callPUT('pet_types', { items });
		const body = (await res.json()) as { ok: boolean; rev: string };

		expect(body).toEqual({ ok: true, rev: '4-new' });
		const [path, method, doc] = adminRawMock.mock.calls[0];
		expect(path).toBe('/registry/master_data%3Apet_types');
		expect(method).toBe('PUT');
		expect((doc as MasterData).created_by).toBe('sa-user');
		expect((doc as MasterData).type).toBe('master_data');
		expect((doc as MasterData).master_type).toBe('pet_types');
	});

	it('writes a shelter-local document when shelter scope is supplied', async () => {
		readMock.mockResolvedValue(null);

		const res = await callPUT(
			'pet_types',
			{ shelter_code: 'SH001', items },
			'?scope=shelter&shelter_code=SH001'
		);
		expect(res.status).toBe(200);
		const [path, method, doc] = adminRawMock.mock.calls[0];
		expect(path).toBe('/registry/master_data%3Apet_types%3ASH001');
		expect(method).toBe('PUT');
		expect((doc as MasterData).schema_v).toBe(2);
		expect((doc as MasterData).shelter_code).toBe('SH001');
		expect(authMock).toHaveBeenCalledWith('AuthSession=abc', 'SH001');
	});

	it('stores only shelter-specific items when effective values include global items', async () => {
		readMock.mockImplementation(async (_type, shelterCode) =>
			shelterCode
				? null
				: existingDoc([
						{ code: 'dog', label: 'Dog', is_default: false },
						{ code: 'cat', label: 'Cat', is_default: true }
					])
		);

		await callPUT(
			'pet_types',
			{
				shelter_code: 'SH001',
				items: [
					{ code: 'dog', label: 'Dog', is_default: false },
					{ code: 'cat', label: 'Cat', is_default: true },
					{ code: 'local_dog', label: 'Local dog', is_default: false }
				]
			},
			'?scope=shelter&shelter_code=SH001'
		);

		const doc = writtenDoc();
		expect(doc.items).toEqual([{ code: 'local_dog', label: 'Local dog', is_default: false }]);
		expect(doc.excluded_codes).toBeUndefined();
	});

	it('rejects shelter_code on a global write', async () => {
		const res = await callPUT('pet_types', { shelter_code: 'SH001', items }, '?scope=global');
		expect(res.status).toBe(422);
		expect((await res.json()).error.code).toBe('VALIDATION');
		expect(adminRawMock).not.toHaveBeenCalled();
	});

	it('preserves the existing envelope (created_by, _rev) on update', async () => {
		readMock.mockResolvedValue(existingDoc([{ code: 'dog', label: 'Dog', is_default: true }]));

		await callPUT('pet_types', { items });
		const doc = writtenDoc();
		expect(doc.created_by).toBe('origauthor');
		expect(doc._rev).toBe('3-old');
		expect(doc.items).toEqual(items);
	});

	it('collapses multiple defaults down to exactly one (enforceOneDefault)', async () => {
		readMock.mockResolvedValue(null);
		await callPUT('pet_types', {
			items: [
				{ code: 'dog', label: 'Dog', is_default: true },
				{ code: 'cat', label: 'Cat', is_default: true }
			]
		});
		const defaults = writtenDoc().items.filter((i) => i.is_default);
		expect(defaults).toHaveLength(1);
	});

	it('rejects malformed items (bad code) via the contract envelope', async () => {
		readMock.mockResolvedValue(null);
		const res = await callPUT('pet_types', {
			items: [{ code: 'BadCode', label: 'x', is_default: false }]
		});
		expect(res.status).toBe(500);
		expect(adminRawMock).not.toHaveBeenCalled();
	});

	it('maps a CouchDB 409 to CONFLICT', async () => {
		readMock.mockResolvedValue(null);
		adminRawMock.mockResolvedValue({ status: 409, data: {} });
		const res = await callPUT('pet_types', { items });
		expect(res.status).toBe(409);
		expect((await res.json()).error.code).toBe('CONFLICT');
	});

	it('maps a CouchDB 5xx to INTERNAL', async () => {
		readMock.mockResolvedValue(null);
		adminRawMock.mockResolvedValue({ status: 500, data: {} });
		const res = await callPUT('pet_types', { items });
		expect(res.status).toBe(500);
		expect((await res.json()).error.code).toBe('INTERNAL');
	});

	it('fails INTERNAL when CouchDB returns no rev', async () => {
		readMock.mockResolvedValue(null);
		adminRawMock.mockResolvedValue({ status: 201, data: {} });
		const res = await callPUT('pet_types', { items });
		expect(res.status).toBe(500);
		expect((await res.json()).error.code).toBe('INTERNAL');
	});
});
