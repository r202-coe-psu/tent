import { describe, it, expect, beforeEach, vi } from 'vitest';
import { error } from '@sveltejs/kit';

// Partial mock: keep the real ServiceError / serviceError contract helpers,
// stub only the CouchDB-touching auth guard.
vi.mock('$lib/server/couch-admin', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/couch-admin')>();
	return { ...actual, requireAdmin: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('$lib/server/master-data-server', () => ({ readMasterDoc: vi.fn() }));

import { GET } from './+server';
import { requireAdmin } from '$lib/server/couch-admin';
import { readMasterDoc } from '$lib/server/master-data-server';
import { MASTER_DATA_TYPES, type MasterData } from '$lib/features/master-data';

const requireAdminMock = vi.mocked(requireAdmin);
const readMock = vi.mocked(readMasterDoc);

function call(cookie: string | null = 'AuthSession=abc') {
	const request = new Request('http://localhost/api/back-office/master-data', {
		headers: cookie ? { cookie } : {}
	});
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
		requireAdminMock.mockReset().mockResolvedValue(undefined);
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

	it('forwards the request cookie to the admin guard', async () => {
		readMock.mockResolvedValue(null);
		await call('AuthSession=xyz');
		expect(requireAdminMock).toHaveBeenCalledWith('AuthSession=xyz');
	});

	it('propagates the guard rejection (401/403) instead of swallowing it', async () => {
		requireAdminMock.mockImplementationOnce(() => {
			throw error(403, 'Admin privileges required');
		});
		const err = await Promise.resolve(call()).catch((e: unknown) => e);
		expect((err as { status?: number }).status).toBe(403);
	});
});
