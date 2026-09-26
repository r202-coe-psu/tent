import { describe, it, expect, beforeEach, vi } from 'vitest';
import { error } from '@sveltejs/kit';

// GET and shelter-scoped writes use requireShelterScopeOrSA; global writes use
// requireSystemAdmin (app SA role or CouchDB `_admin`).
const caller = {
	name: 'mgr',
	roles: ['shelter:SH001', 'shelter_manager'],
	isSA: false,
	shelterCode: 'SH001'
};
const saCaller = {
	name: 'sa-user',
	roles: ['system_admin'],
	isSA: true,
	shelterCode: null as string | null
};
vi.mock('$lib/server/couch-admin', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/couch-admin')>();
	return {
		...actual,
		requireSystemAdmin: vi.fn().mockResolvedValue({
			name: 'sa-user',
			roles: ['system_admin'],
			isSA: true,
			shelterCode: null
		}),
		requireShelterScopeOrSA: vi.fn().mockResolvedValue({
			name: 'mgr',
			roles: ['shelter:SH001', 'shelter_manager'],
			isSA: false,
			shelterCode: 'SH001'
		}),
		requireShelterManagerOrSA: vi.fn().mockResolvedValue({
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
	readMasterDoc: vi.fn(),
	readShelterMasterDocs: vi.fn()
}));

import { GET, PUT } from './+server';
import {
	requireSystemAdmin,
	requireShelterManagerOrSA,
	requireShelterScopeOrSA,
	adminRaw
} from '$lib/server/couch-admin';
import { readMasterDoc, readShelterMasterDocs } from '$lib/server/master-data-server';
import type { MasterData } from '$lib/features/master-data/domain';

const requireSystemAdminMock = vi.mocked(requireSystemAdmin);
const authMock = vi.mocked(requireShelterScopeOrSA);
const mgrMock = vi.mocked(requireShelterManagerOrSA);
const adminRawMock = vi.mocked(adminRaw);
const readMock = vi.mocked(readMasterDoc);
const readShelterDocsMock = vi.mocked(readShelterMasterDocs);

type ItemFixture = Omit<MasterData['items'][number], 'status'> &
	Partial<Pick<MasterData['items'][number], 'status'>>;

function existingDoc(items: ItemFixture[]): MasterData {
	return {
		_id: 'master_data:housing_type',
		_rev: '3-old',
		type: 'master_data',
		schema_v: 1,
		master_type: 'housing_type',
		items: items.map((i) => ({ ...i, status: i.status ?? 'active' })),
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
	requireSystemAdminMock.mockReset().mockResolvedValue(saCaller);
	authMock.mockReset().mockResolvedValue(caller);
	mgrMock.mockReset().mockResolvedValue(caller);
	adminRawMock.mockReset().mockResolvedValue({ status: 201, data: { rev: '4-new' } });
	readMock.mockReset();
	readShelterDocsMock.mockReset().mockResolvedValue([]);
});

describe('GET /api/back-office/master-data/[type]', () => {
	it('returns the doc items for a valid type', async () => {
		readMock.mockResolvedValue(
			existingDoc([{ code: 'dog', label_th: 'Dog', label_en: 'Dog', is_default: true }])
		);

		const res = await callGET('housing_type');
		const body = (await res.json()) as { master_type: string; items: unknown[] };

		expect(res.status).toBe(200);
		expect(body.master_type).toBe('housing_type');
		expect(body.items).toHaveLength(1);
	});

	it('returns an empty placeholder when the doc does not exist yet', async () => {
		readMock.mockResolvedValue(null);
		const res = await callGET('housing_type');
		expect((await res.json()).items).toEqual([]);
	});

	it('trims shelter_code query parameters before resolving scope', async () => {
		readMock.mockResolvedValue(null);

		const res = await callGET('housing_type', '?scope=shelter&shelter_code=%20SH001%20');

		expect(res.status).toBe(200);
		expect(authMock).toHaveBeenCalledWith('AuthSession=abc', 'SH001');
		expect(readMock).toHaveBeenCalledWith('housing_type', 'SH001');
	});

	it('resolves a shelter-local document before the global document', async () => {
		readMock.mockImplementation(async (_type, shelterCode) =>
			shelterCode === 'SH001'
				? {
						...existingDoc([{ code: 'cat', label_th: 'Cat', label_en: 'Cat', is_default: true }]),
						_id: 'master_data:housing_type:SH001',
						shelter_code: 'SH001',
						schema_v: 2
					}
				: { ...existingDoc([{ code: 'dog', label_th: 'Dog', label_en: 'Dog', is_default: true }]) }
		);

		const res = await callGET('housing_type', '?scope=effective&shelter_code=SH001');
		const body = (await res.json()) as {
			items: unknown[];
			item_sources: Record<string, { scope: string; shelter_code?: string | null }>;
		};
		// Two-tier default resolution: the shelter-local default ('cat') supersedes
		// the global default ('dog'), so only one effective default remains.
		expect(body.items).toEqual([
			{ code: 'dog', label_th: 'Dog', label_en: 'Dog', is_default: false, status: 'active' },
			{ code: 'cat', label_th: 'Cat', label_en: 'Cat', is_default: true, status: 'active' }
		]);
		expect(body.item_sources).toEqual({
			dog: { scope: 'global', shelter_code: null, shelter_disabled: false },
			cat: { scope: 'shelter', shelter_code: 'SH001' }
		});
		expect(readMock).toHaveBeenCalledWith('housing_type', 'SH001');
	});

	it('disables a global item for the shelter via disabled_global_codes (global doc untouched)', async () => {
		readMock.mockImplementation(async (_type, shelterCode) =>
			shelterCode === 'SH001'
				? {
						...existingDoc([]),
						_id: 'master_data:housing_type:SH001',
						shelter_code: 'SH001',
						disabled_global_codes: ['dog'],
						schema_v: 3
					}
				: existingDoc([{ code: 'dog', label_th: 'Dog', label_en: 'Dog', is_default: true }])
		);

		const res = await callGET('housing_type', '?scope=effective&shelter_code=SH001');
		const body = (await res.json()) as {
			items: { code: string; status: string }[];
			item_sources: Record<string, { scope: string; shelter_disabled?: boolean }>;
		};
		// Global 'dog' resolves inactive for THIS shelter; source flags it. A
		// disabled item can't be the effective default, so is_default clears too.
		expect(body.items).toEqual([
			{ code: 'dog', label_th: 'Dog', label_en: 'Dog', is_default: false, status: 'inactive' }
		]);
		expect(body.item_sources.dog).toEqual({
			scope: 'global',
			shelter_code: null,
			shelter_disabled: true
		});
	});

	it('lets a shelter point at a non-default GLOBAL item via default_global_code', async () => {
		readMock.mockImplementation(async (_type, shelterCode) =>
			shelterCode === 'SH001'
				? {
						...existingDoc([]),
						_id: 'master_data:housing_type:SH001',
						shelter_code: 'SH001',
						default_global_code: 'dog_b',
						schema_v: 3
					}
				: existingDoc([
						{ code: 'dog_a', label_th: 'Dog A', label_en: 'Dog A', is_default: true },
						{ code: 'dog_b', label_th: 'Dog B', label_en: 'Dog B', is_default: false }
					])
		);

		const res = await callGET('housing_type', '?scope=effective&shelter_code=SH001');
		const body = (await res.json()) as {
			items: { code: string; is_default: boolean }[];
		};
		expect(body.items).toEqual([
			{ code: 'dog_a', label_th: 'Dog A', label_en: 'Dog A', is_default: false, status: 'active' },
			{ code: 'dog_b', label_th: 'Dog B', label_en: 'Dog B', is_default: true, status: 'active' }
		]);
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
		const err = await Promise.resolve(callGET('housing_type')).catch((e: unknown) => e);
		expect((err as { status?: number }).status).toBe(401);
	});
});

describe('PUT /api/back-office/master-data/[type]', () => {
	const items = [{ code: 'dog', label_th: 'Dog', label_en: 'Dog', is_default: false }];

	it('rejects a body without an items array (422 VALIDATION)', async () => {
		const res = await callPUT('housing_type', { nope: true });
		expect(res.status).toBe(422);
		expect((await res.json()).error.code).toBe('VALIDATION');
		expect(adminRawMock).not.toHaveBeenCalled();
	});

	it('rejects two items sharing a label within the same type (422 VALIDATION, CR-078)', async () => {
		readMock.mockResolvedValue(null);

		const res = await callPUT('housing_type', {
			items: [
				{ code: 'dog', label_th: 'สุนัข', label_en: 'สุนัข', is_default: false },
				{ code: 'dog2', label_th: ' สุนัข ', label_en: ' สุนัข ', is_default: false }
			]
		});

		expect(res.status).toBe(422);
		expect((await res.json()).error.code).toBe('VALIDATION');
		expect(adminRawMock).not.toHaveBeenCalled();
	});

	it('counts an inactive item as taking its label (CR-078)', async () => {
		readMock.mockResolvedValue(null);

		const res = await callPUT('housing_type', {
			items: [
				{
					code: 'dog',
					label_th: 'สุนัข',
					label_en: 'สุนัข',
					is_default: false,
					status: 'inactive'
				},
				{ code: 'dog2', label_th: 'สุนัข', label_en: 'สุนัข', is_default: false }
			]
		});

		expect(res.status).toBe(422);
		expect(adminRawMock).not.toHaveBeenCalled();
	});

	it('rejects a shelter-local label that collides with a GLOBAL item (CR-078)', async () => {
		// readMasterDoc(type) with no shelter code → the global tier.
		readMock.mockImplementation(async (_type, shelterCode) =>
			shelterCode
				? null
				: existingDoc([{ code: 'dog', label_th: 'สุนัข', label_en: 'สุนัข', is_default: true }])
		);

		const res = await callPUT(
			'housing_type',
			{
				shelter_code: 'SH001',
				items: [{ code: 'local1', label_th: 'สุนัข', label_en: 'สุนัข', is_default: false }]
			},
			'?scope=shelter&shelter_code=SH001'
		);

		expect(res.status).toBe(422);
		expect((await res.json()).error.code).toBe('VALIDATION');
		expect(adminRawMock).not.toHaveBeenCalled();
	});

	it('allows a shelter-local label that no global item uses (CR-078)', async () => {
		readMock.mockImplementation(async (_type, shelterCode) =>
			shelterCode
				? null
				: existingDoc([{ code: 'dog', label_th: 'สุนัข', label_en: 'สุนัข', is_default: true }])
		);

		const res = await callPUT(
			'housing_type',
			{
				shelter_code: 'SH001',
				items: [{ code: 'local1', label_th: 'กระต่าย', label_en: 'กระต่าย', is_default: false }]
			},
			'?scope=shelter&shelter_code=SH001'
		);

		expect(res.status).toBe(200);
		expect(adminRawMock).toHaveBeenCalled();
	});

	it('rejects a GLOBAL label that collides with an existing shelter-local item (CR-078)', async () => {
		readMock.mockResolvedValue(null);
		readShelterDocsMock.mockResolvedValue([
			{
				...existingDoc([
					{ code: 'local1', label_th: 'สุนัข', label_en: 'สุนัข', is_default: false }
				]),
				_id: 'master_data:housing_type:SH001',
				shelter_code: 'SH001'
			}
		]);

		const res = await callPUT('housing_type', {
			items: [{ code: 'g1', label_th: 'สุนัข', label_en: 'สุนัข', is_default: false }]
		});

		expect(res.status).toBe(422);
		expect((await res.json()).error.code).toBe('VALIDATION');
		expect(adminRawMock).not.toHaveBeenCalled();
	});

	it('allows a GLOBAL label no shelter uses (CR-078)', async () => {
		readMock.mockResolvedValue(null);
		readShelterDocsMock.mockResolvedValue([
			{
				...existingDoc([
					{ code: 'local1', label_th: 'สุนัข', label_en: 'สุนัข', is_default: false }
				]),
				_id: 'master_data:housing_type:SH001',
				shelter_code: 'SH001'
			}
		]);

		const res = await callPUT('housing_type', {
			items: [{ code: 'g1', label_th: 'กระต่าย', label_en: 'กระต่าย', is_default: false }]
		});

		expect(res.status).toBe(200);
	});

	it('lets an unrelated edit through when the doc already held duplicates (CR-078)', async () => {
		// Data written before the rule existed: two items share a label. Toggling
		// one item's status must not be rejected, or the doc becomes unfixable.
		const legacy = [
			{ code: 'dog', label_th: 'สุนัข', label_en: 'สุนัข', is_default: true },
			{ code: 'dog2', label_th: 'สุนัข', label_en: 'สุนัข', is_default: false }
		];
		readMock.mockResolvedValue(existingDoc(legacy));

		const res = await callPUT('housing_type', {
			items: [
				{ code: 'dog', label_th: 'สุนัข', label_en: 'สุนัข', is_default: true, status: 'inactive' },
				{ code: 'dog2', label_th: 'สุนัข', label_en: 'สุนัข', is_default: false }
			]
		});

		expect(res.status).toBe(200);
		expect(writtenDoc().items[0].status).toBe('inactive');
	});

	it('still rejects a NEW duplicate on a doc that already held a legacy one (CR-078)', async () => {
		readMock.mockResolvedValue(
			existingDoc([
				{ code: 'dog', label_th: 'สุนัข', label_en: 'สุนัข', is_default: true },
				{ code: 'dog2', label_th: 'สุนัข', label_en: 'สุนัข', is_default: false }
			])
		);

		const res = await callPUT('housing_type', {
			items: [
				{ code: 'dog', label_th: 'สุนัข', label_en: 'สุนัข', is_default: true },
				{ code: 'dog2', label_th: 'สุนัข', label_en: 'สุนัข', is_default: false },
				{ code: 'cat', label_th: 'แมว', label_en: 'แมว', is_default: false },
				{ code: 'cat2', label_th: 'แมว', label_en: 'แมว', is_default: false }
			]
		});

		expect(res.status).toBe(422);
		expect(adminRawMock).not.toHaveBeenCalled();
	});

	it('collapses items that repeat one code, keeping the first (CR-078)', async () => {
		readMock.mockResolvedValue(null);

		const res = await callPUT('housing_type', {
			items: [
				{ code: 'dog', label_th: 'สุนัข', label_en: 'สุนัข', is_default: true },
				{ code: 'dog', label_th: 'สุนัข', label_en: 'สุนัข', is_default: false }
			]
		});

		expect(res.status).toBe(200);
		const items = writtenDoc().items;
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ code: 'dog', is_default: true });
	});

	it('creates a fresh envelope stamped with the authenticated SA name when absent', async () => {
		readMock.mockResolvedValue(null);

		const res = await callPUT('housing_type', { items });
		const body = (await res.json()) as { ok: boolean; rev: string };

		expect(body).toEqual({ ok: true, rev: '4-new' });
		const [path, method, doc] = adminRawMock.mock.calls[0];
		expect(path).toBe('/registry/master_data%3Ahousing_type');
		expect(method).toBe('PUT');
		expect((doc as MasterData).created_by).toBe('sa-user');
		expect((doc as MasterData).type).toBe('master_data');
		expect((doc as MasterData).master_type).toBe('housing_type');
		expect(requireSystemAdminMock).toHaveBeenCalledWith('AuthSession=abc');
	});

	it('allows global PUT for system_admin without CouchDB _admin', async () => {
		requireSystemAdminMock.mockResolvedValue({
			name: 'app-sa',
			roles: ['system_admin'],
			isSA: true,
			shelterCode: null
		});
		readMock.mockResolvedValue(null);

		const res = await callPUT('housing_type', { items });

		expect(res.status).toBe(200);
		expect(writtenDoc().created_by).toBe('app-sa');
		expect(requireSystemAdminMock).toHaveBeenCalled();
	});

	it('rejects global PUT for staff without system_admin (403)', async () => {
		requireSystemAdminMock.mockImplementationOnce(() => {
			throw error(403, 'System admin privileges required');
		});

		const err = await Promise.resolve(callPUT('housing_type', { items })).catch((e: unknown) => e);
		expect((err as { status?: number }).status).toBe(403);
		expect(adminRawMock).not.toHaveBeenCalled();
	});

	it('writes a shelter-local document when shelter scope is supplied', async () => {
		readMock.mockResolvedValue(null);

		const res = await callPUT(
			'housing_type',
			{ shelter_code: 'SH001', items },
			'?scope=shelter&shelter_code=SH001'
		);
		expect(res.status).toBe(200);
		const [path, method, doc] = adminRawMock.mock.calls[0];
		expect(path).toBe('/registry/master_data%3Ahousing_type%3ASH001');
		expect(method).toBe('PUT');
		expect((doc as MasterData).schema_v).toBe(4);
		expect((doc as MasterData).shelter_code).toBe('SH001');
		expect(mgrMock).toHaveBeenCalledWith('AuthSession=abc', 'SH001');
	});

	it('accepts padded shelter_code query with an equivalent trimmed body code', async () => {
		readMock.mockResolvedValue(null);

		const res = await callPUT(
			'housing_type',
			{ shelter_code: 'SH001', items },
			'?scope=shelter&shelter_code=%20SH001%20'
		);

		expect(res.status).toBe(200);
		expect(mgrMock).toHaveBeenCalledWith('AuthSession=abc', 'SH001');
		expect(writtenDoc().shelter_code).toBe('SH001');
	});

	it('writes the submitted shelter-local items verbatim (no split against the global doc)', async () => {
		// The global doc is read only to check label uniqueness across tiers
		// (CR-078); it is never merged into the written doc -- the UI sends only
		// the shelter-local items (global is read-only client-side).
		readMock.mockResolvedValue(null);

		await callPUT(
			'housing_type',
			{
				shelter_code: 'SH001',
				items: [
					{ code: 'local_dog', label_th: 'Local dog', label_en: 'Local dog', is_default: false }
				]
			},
			'?scope=shelter&shelter_code=SH001'
		);

		const doc = writtenDoc();
		expect(doc.items).toEqual([
			{
				code: 'local_dog',
				label_th: 'Local dog',
				label_en: 'Local dog',
				is_default: false,
				status: 'active'
			}
		]);
		expect(readMock).toHaveBeenCalledWith('housing_type', 'SH001');
	});

	it('defaults items without a status field to active', async () => {
		readMock.mockResolvedValue(null);
		await callPUT('housing_type', { items });
		const doc = writtenDoc();
		expect(doc.items).toEqual([
			{ code: 'dog', label_th: 'Dog', label_en: 'Dog', is_default: false, status: 'active' }
		]);
	});

	it('rejects shelter_code on a global write', async () => {
		const res = await callPUT('housing_type', { shelter_code: 'SH001', items }, '?scope=global');
		expect(res.status).toBe(422);
		expect((await res.json()).error.code).toBe('VALIDATION');
		expect(adminRawMock).not.toHaveBeenCalled();
	});

	it('preserves the existing envelope (created_by, _rev) on update', async () => {
		readMock.mockResolvedValue(
			existingDoc([{ code: 'dog', label_th: 'Dog', label_en: 'Dog', is_default: true }])
		);

		await callPUT('housing_type', { items });
		const doc = writtenDoc();
		expect(doc.created_by).toBe('origauthor');
		expect(doc._rev).toBe('3-old');
		expect(doc.items).toEqual([{ ...items[0], status: 'active' }]);
	});

	it('collapses multiple defaults down to exactly one (enforceOneDefault)', async () => {
		readMock.mockResolvedValue(null);
		await callPUT('housing_type', {
			items: [
				{ code: 'dog', label_th: 'Dog', label_en: 'Dog', is_default: true },
				{ code: 'cat', label_th: 'Cat', label_en: 'Cat', is_default: true }
			]
		});
		const defaults = writtenDoc().items.filter((i) => i.is_default);
		expect(defaults).toHaveLength(1);
	});

	it('rejects malformed items (bad code) via the contract envelope', async () => {
		readMock.mockResolvedValue(null);
		const res = await callPUT('housing_type', {
			items: [{ code: 'BadCode', label_th: 'x', label_en: 'x', is_default: false }]
		});
		expect(res.status).toBe(500);
		expect(adminRawMock).not.toHaveBeenCalled();
	});

	it('maps a CouchDB 409 to CONFLICT', async () => {
		readMock.mockResolvedValue(null);
		adminRawMock.mockResolvedValue({ status: 409, data: {} });
		const res = await callPUT('housing_type', { items });
		expect(res.status).toBe(409);
		expect((await res.json()).error.code).toBe('CONFLICT');
	});

	it('maps a CouchDB 5xx to INTERNAL', async () => {
		readMock.mockResolvedValue(null);
		adminRawMock.mockResolvedValue({ status: 500, data: {} });
		const res = await callPUT('housing_type', { items });
		expect(res.status).toBe(500);
		expect((await res.json()).error.code).toBe('INTERNAL');
	});

	it('fails INTERNAL when CouchDB returns no rev', async () => {
		readMock.mockResolvedValue(null);
		adminRawMock.mockResolvedValue({ status: 201, data: {} });
		const res = await callPUT('housing_type', { items });
		expect(res.status).toBe(500);
		expect((await res.json()).error.code).toBe('INTERNAL');
	});
});
