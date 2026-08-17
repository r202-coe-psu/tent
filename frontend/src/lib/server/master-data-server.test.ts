import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/server/couch-admin', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/couch-admin')>()),
	adminRaw: vi.fn()
}));

import { adminRaw, ServiceError } from '$lib/server/couch-admin';
import { readShelterMasterDocs } from './master-data-server';
import type { MasterData } from '$lib/features/master-data/domain';

const adminRawMock = vi.mocked(adminRaw);

function shelterDoc(shelterCode: string): MasterData {
	return {
		_id: `master_data:pet_types:${shelterCode}`,
		type: 'master_data',
		schema_v: 3,
		master_type: 'pet_types',
		shelter_code: shelterCode,
		items: [{ code: 'dog', label: 'สุนัข', is_default: true, status: 'active' }],
		created_at: '2026-01-01T00:00:00.000Z',
		updated_at: '2026-01-01T00:00:00.000Z',
		created_by: 'seed'
	};
}

/** The path passed to adminRaw on the last call. */
function requestedPath(): string {
	return adminRawMock.mock.calls[0][0];
}

beforeEach(() => {
	adminRawMock.mockReset();
});

describe('readShelterMasterDocs', () => {
	it('percent-encodes the JSON range keys instead of interpolating them raw', async () => {
		adminRawMock.mockResolvedValue({ status: 200, data: { rows: [] } });

		await readShelterMasterDocs('pet_types');

		const path = requestedPath();
		// startkey/endkey are JSON strings — quotes and the U+FFF0 sentinel must
		// not travel unescaped through a proxy in front of CouchDB.
		expect(path).toContain('startkey=%22master_data%3Apet_types%3A%22');
		expect(path).toContain('endkey=%22master_data%3Apet_types%3A%EF%BF%B0%22');
		expect(path).not.toContain('"');
		expect(path).toContain('include_docs=true');
	});

	it('scans only ids carrying a shelter suffix, never the global doc', async () => {
		adminRawMock.mockResolvedValue({ status: 200, data: { rows: [] } });

		await readShelterMasterDocs('pet_types');

		// The range starts AFTER `master_data:pet_types` + ':' so the global doc
		// (`master_data:pet_types`, no suffix) falls outside it.
		const startkey = decodeURIComponent(requestedPath().match(/startkey=([^&]+)/)![1]);
		expect(JSON.parse(startkey)).toBe('master_data:pet_types:');
	});

	it('returns the docs of every shelter that has a local list', async () => {
		adminRawMock.mockResolvedValue({
			status: 200,
			data: { rows: [{ doc: shelterDoc('SH001') }, { doc: shelterDoc('SH002') }] }
		});

		const docs = await readShelterMasterDocs('pet_types');

		expect(docs.map((d) => d.shelter_code)).toEqual(['SH001', 'SH002']);
	});

	it('skips rows without a usable doc', async () => {
		adminRawMock.mockResolvedValue({
			status: 200,
			data: {
				rows: [
					{ doc: shelterDoc('SH001') },
					{ doc: null },
					{},
					{ doc: { _id: 'master_data:pet_types:SH003' } }
				]
			}
		});

		const docs = await readShelterMasterDocs('pet_types');

		// A row whose doc has no items[] cannot be item-scanned — drop it rather
		// than letting `.flatMap((d) => d.items)` blow up at the call site.
		expect(docs).toHaveLength(1);
		expect(docs[0].shelter_code).toBe('SH001');
	});

	it('returns an empty list when CouchDB answers without rows', async () => {
		adminRawMock.mockResolvedValue({ status: 200, data: {} });
		await expect(readShelterMasterDocs('pet_types')).resolves.toEqual([]);
	});

	it('throws ServiceError on a CouchDB error so the write is not let through', async () => {
		adminRawMock.mockResolvedValue({ status: 500, data: { error: 'internal' } });

		await expect(readShelterMasterDocs('pet_types')).rejects.toBeInstanceOf(ServiceError);
	});
});
