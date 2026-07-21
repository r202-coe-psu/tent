import { describe, it, expect, beforeEach, vi } from 'vitest';
import { error } from '@sveltejs/kit';

vi.mock('$lib/server/couch-admin', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/couch-admin')>();
	return {
		...actual,
		requireAdmin: vi.fn().mockResolvedValue(undefined),
		adminRaw: vi.fn()
	};
});
vi.mock('$lib/server/master-data-server', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/master-data-server')>()),
	readMasterDoc: vi.fn()
}));

import { DELETE } from './+server';
import { requireAdmin, adminRaw } from '$lib/server/couch-admin';
import { readMasterDoc } from '$lib/server/master-data-server';
import type { MasterData } from '$lib/features/master-data/domain';

const requireAdminMock = vi.mocked(requireAdmin);
const adminRawMock = vi.mocked(adminRaw);
const readMock = vi.mocked(readMasterDoc);

function docWith(items: MasterData['items']): MasterData {
	return {
		_id: 'master_data:pet_types',
		_rev: '3-old',
		type: 'master_data',
		schema_v: 1,
		master_type: 'pet_types',
		items,
		created_at: '2026-01-01T00:00:00.000Z',
		updated_at: '2026-01-02T00:00:00.000Z',
		created_by: 'sa-bootstrap'
	};
}

function callDELETE(type: string, code: string, query = '') {
	const request = new Request(
		`http://localhost/api/back-office/master-data/${type}/items/${code}${query}`,
		{ method: 'DELETE', headers: { cookie: 'AuthSession=abc' } }
	);
	return DELETE({ request, params: { type, code } } as unknown as Parameters<typeof DELETE>[0]);
}

beforeEach(() => {
	requireAdminMock.mockReset().mockResolvedValue('sa-user');
	adminRawMock.mockReset().mockResolvedValue({ status: 200, data: { rev: '4-new' } });
	readMock.mockReset();
});

describe('DELETE /api/back-office/master-data/[type]/items/[code]', () => {
	it('rejects a blank code (422 VALIDATION)', async () => {
		const res = await callDELETE('pet_types', '   ');
		expect(res.status).toBe(422);
		expect((await res.json()).error.code).toBe('VALIDATION');
		expect(adminRawMock).not.toHaveBeenCalled();
	});

	it('returns CONFLICT when the master_data doc does not exist', async () => {
		readMock.mockResolvedValue(null);
		const res = await callDELETE('pet_types', 'dog');
		expect(res.status).toBe(409);
		expect((await res.json()).error.code).toBe('CONFLICT');
	});

	it('filters the item out and writes the doc back', async () => {
		readMock.mockResolvedValue(
			docWith([
				{ code: 'dog', label: 'Dog', is_default: false },
				{ code: 'cat', label: 'Cat', is_default: false }
			])
		);

		const res = await callDELETE('pet_types', 'dog');
		const body = (await res.json()) as { ok: boolean; rev: string };

		expect(body).toEqual({ ok: true, rev: '4-new' });
		const [path, method, doc] = adminRawMock.mock.calls[0];
		expect(path).toBe('/registry/master_data%3Apet_types');
		expect(method).toBe('PUT');
		expect((doc as MasterData).items.map((i) => i.code)).toEqual(['cat']);
	});

	it('deletes from the shelter-local document when scoped', async () => {
		readMock.mockResolvedValue({
			...docWith([{ code: 'dog', label: 'Dog', is_default: false }]),
			_id: 'master_data:pet_types:SH001',
			schema_v: 2,
			shelter_code: 'SH001'
		});

		await callDELETE('pet_types', 'dog', '?scope=shelter&shelter_code=SH001');
		const [path, , doc] = adminRawMock.mock.calls[0];
		expect(path).toBe('/registry/master_data%3Apet_types%3ASH001');
		expect((doc as MasterData).shelter_code).toBe('SH001');
	});

	it('creates a local override when deleting an item inherited from global', async () => {
		readMock.mockImplementation(async (_type, shelterCode) =>
			shelterCode
				? null
				: docWith([
						{ code: 'dog', label: 'Dog', is_default: false },
						{ code: 'cat', label: 'Cat', is_default: true }
					])
		);

		await callDELETE('pet_types', 'dog', '?scope=shelter&shelter_code=SH001');
		const [path, , doc] = adminRawMock.mock.calls[0];
		expect(path).toBe('/registry/master_data%3Apet_types%3ASH001');
		expect((doc as MasterData)._rev).toBeUndefined();
		expect((doc as MasterData).created_by).toBe('sa-user');
		expect((doc as MasterData).items).toEqual([]);
		expect((doc as MasterData).excluded_codes).toEqual(['dog']);
	});

	it('is idempotent — a missing code returns ok without writing', async () => {
		readMock.mockResolvedValue(docWith([{ code: 'cat', label: 'Cat', is_default: false }]));

		const res = await callDELETE('pet_types', 'dog');
		const body = (await res.json()) as { ok: boolean; rev: string };

		expect(body).toEqual({ ok: true, rev: '3-old' });
		expect(adminRawMock).not.toHaveBeenCalled();
	});

	it('maps a CouchDB 409 to CONFLICT', async () => {
		readMock.mockResolvedValue(docWith([{ code: 'dog', label: 'Dog', is_default: false }]));
		adminRawMock.mockResolvedValue({ status: 409, data: {} });
		const res = await callDELETE('pet_types', 'dog');
		expect(res.status).toBe(409);
		expect((await res.json()).error.code).toBe('CONFLICT');
	});

	it('maps a CouchDB 5xx to INTERNAL', async () => {
		readMock.mockResolvedValue(docWith([{ code: 'dog', label: 'Dog', is_default: false }]));
		adminRawMock.mockResolvedValue({ status: 500, data: {} });
		const res = await callDELETE('pet_types', 'dog');
		expect(res.status).toBe(500);
		expect((await res.json()).error.code).toBe('INTERNAL');
	});

	it('propagates the admin guard rejection', async () => {
		requireAdminMock.mockImplementationOnce(() => {
			throw error(403, 'Admin privileges required');
		});
		const err = await Promise.resolve(callDELETE('pet_types', 'dog')).catch((e: unknown) => e);
		expect((err as { status?: number }).status).toBe(403);
	});
});
