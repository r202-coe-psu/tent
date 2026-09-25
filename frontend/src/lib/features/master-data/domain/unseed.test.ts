import { describe, expect, it, vi } from 'vitest';
import {
	deleteDatabase,
	deleteDocs,
	findConfigDocs,
	findMasterDataDocs,
	listDatabases,
	unseedAll,
	unseedMaster,
	unseedMasterData
} from '../../../../../scripts/unseed';

describe('unseed script functions', () => {
	it('listDatabases returns database list from CouchDB', async () => {
		const mockReq = vi.fn().mockResolvedValue({
			status: 200,
			data: ['_users', 'registry', 'catalog', 'master_data']
		});
		const dbs = await listDatabases(mockReq);
		expect(dbs).toEqual(['_users', 'registry', 'catalog', 'master_data']);
		expect(mockReq).toHaveBeenCalledWith('GET', '/_all_dbs');
	});

	it('deleteDatabase calls DELETE on couch endpoint and ignores 404', async () => {
		const mockReq = vi.fn().mockResolvedValue({ status: 404, data: { error: 'not_found' } });
		await expect(deleteDatabase('test_db', mockReq)).resolves.not.toThrow();
		expect(mockReq).toHaveBeenCalledWith('DELETE', '/test_db');

		mockReq.mockResolvedValueOnce({ status: 200, data: { ok: true } });
		await expect(deleteDatabase('test_db', mockReq)).resolves.not.toThrow();
	});

	it('deleteDatabase throws on error status', async () => {
		const mockReq = vi.fn().mockResolvedValue({
			status: 500,
			data: { error: 'internal_server_error', reason: 'disk full' }
		});
		await expect(deleteDatabase('test_db', mockReq)).rejects.toThrow('Cannot delete database');
	});

	it('findMasterDataDocs lists master_data:* documents and filters out non-matching rows', async () => {
		const mockReq = vi.fn().mockResolvedValue({
			status: 200,
			data: {
				rows: [
					{ id: 'master_data:vulnerable_group', value: { rev: '1-a' } },
					{ id: 'master_data:shelter_type', value: { rev: '2-b' } },
					{ id: 'master_data:housing_type:SH001', value: { rev: '1-c' } },
					{ id: 'other_doc', value: { rev: '1-d' } }
				]
			}
		});

		const docs = await findMasterDataDocs(mockReq);
		expect(docs).toEqual([
			{ id: 'master_data:vulnerable_group', rev: '1-a' },
			{ id: 'master_data:shelter_type', rev: '2-b' },
			{ id: 'master_data:housing_type:SH001', rev: '1-c' }
		]);
	});

	it('findMasterDataDocs handles 404 gracefully', async () => {
		const mockReq = vi.fn().mockResolvedValue({ status: 404, data: null });
		const docs = await findMasterDataDocs(mockReq);
		expect(docs).toEqual([]);
	});

	it('findConfigDocs lists config:* documents', async () => {
		const mockReq = vi.fn().mockResolvedValue({
			status: 200,
			data: {
				rows: [
					{ id: 'config:app', value: { rev: '1-cfg1' } },
					{ id: 'config:public_portal', value: { rev: '1-cfg2' } }
				]
			}
		});

		const docs = await findConfigDocs(mockReq);
		expect(docs).toEqual([
			{ id: 'config:app', rev: '1-cfg1' },
			{ id: 'config:public_portal', rev: '1-cfg2' }
		]);
	});

	it('deleteDocs bulk marks documents as deleted in target DB', async () => {
		const mockReq = vi.fn().mockResolvedValue({ status: 201, data: [{ ok: true }] });
		await deleteDocs(
			'registry',
			[
				{ id: 'master_data:vg', rev: '1-a' },
				{ id: 'master_data:st', rev: '2-b' }
			],
			mockReq
		);

		expect(mockReq).toHaveBeenCalledWith('POST', '/registry/_bulk_docs', {
			docs: [
				{ _id: 'master_data:vg', _rev: '1-a', _deleted: true },
				{ _id: 'master_data:st', _rev: '2-b', _deleted: true }
			]
		});
	});

	it('unseedMasterData dry-run does not write deletions', async () => {
		const mockReq = vi.fn().mockImplementation(async (method: string, path: string) => {
			if (path === '/_all_dbs') {
				return { status: 200, data: ['_users', 'registry', 'master_data'] };
			}
			if (path.startsWith('/registry/_all_docs')) {
				return {
					status: 200,
					data: {
						rows: [
							{ id: 'master_data:vulnerable_group', value: { rev: '1-a' } },
							{ id: 'master_data:shelter_type', value: { rev: '1-b' } }
						]
					}
				};
			}
			return { status: 200, data: null };
		});

		const result = await unseedMasterData({ confirm: false, req: mockReq });
		expect(result.docs).toEqual(['master_data:vulnerable_group', 'master_data:shelter_type']);
		expect(result.dbs).toEqual(['master_data']);

		// Must not have called _bulk_docs or DELETE
		const wrote = mockReq.mock.calls.some(([m]) => m === 'POST' || m === 'DELETE');
		expect(wrote).toBe(false);
	});

	it('unseedMasterData with confirm deletes docs from registry and drops master_data DB', async () => {
		const mockReq = vi.fn().mockImplementation(async (method: string, path: string) => {
			if (path === '/_all_dbs') {
				return { status: 200, data: ['_users', 'registry', 'master_data', 'shelter_sh001'] };
			}
			if (path.startsWith('/registry/_all_docs')) {
				return {
					status: 200,
					data: {
						rows: [{ id: 'master_data:vulnerable_group', value: { rev: '1-a' } }]
					}
				};
			}
			if (method === 'POST' && path === '/registry/_bulk_docs') {
				return { status: 201, data: [{ ok: true }] };
			}
			if (method === 'DELETE' && path === '/master_data') {
				return { status: 200, data: { ok: true } };
			}
			return { status: 200, data: null };
		});

		const result = await unseedMasterData({ confirm: true, req: mockReq });
		expect(result.docs).toEqual(['master_data:vulnerable_group']);
		expect(result.dbs).toEqual(['master_data']);

		expect(mockReq).toHaveBeenCalledWith('POST', '/registry/_bulk_docs', {
			docs: [{ _id: 'master_data:vulnerable_group', _rev: '1-a', _deleted: true }]
		});
		expect(mockReq).toHaveBeenCalledWith('DELETE', '/master_data');
		// Must not touch registry or shelter_sh001 databases
		expect(mockReq).not.toHaveBeenCalledWith('DELETE', '/registry');
		expect(mockReq).not.toHaveBeenCalledWith('DELETE', '/shelter_sh001');
	});

	it('unseedMaster with confirm deletes master_data, config, and catalog DB', async () => {
		const mockReq = vi.fn().mockImplementation(async (method: string, path: string) => {
			if (path === '/_all_dbs') {
				return { status: 200, data: ['_users', 'registry', 'catalog', 'shelter_sh001'] };
			}
			if (path.startsWith('/registry/_all_docs')) {
				if (path.includes('startkey=%22master_data%22')) {
					return {
						status: 200,
						data: { rows: [{ id: 'master_data:housing_type', value: { rev: '1-a' } }] }
					};
				}
				if (path.includes('startkey=%22config%3A%22')) {
					return {
						status: 200,
						data: { rows: [{ id: 'config:app', value: { rev: '1-cfg' } }] }
					};
				}
			}
			if (method === 'POST' && path === '/registry/_bulk_docs') {
				return { status: 201, data: [{ ok: true }] };
			}
			if (method === 'DELETE' && path === '/catalog') {
				return { status: 200, data: { ok: true } };
			}
			return { status: 200, data: null };
		});

		const result = await unseedMaster({ confirm: true, req: mockReq });
		expect(result.docs).toEqual(['master_data:housing_type', 'config:app']);
		expect(result.dbs).toEqual(['catalog']);

		expect(mockReq).toHaveBeenCalledWith('POST', '/registry/_bulk_docs', {
			docs: [
				{ _id: 'master_data:housing_type', _rev: '1-a', _deleted: true },
				{ _id: 'config:app', _rev: '1-cfg', _deleted: true }
			]
		});
		expect(mockReq).toHaveBeenCalledWith('DELETE', '/catalog');
		expect(mockReq).not.toHaveBeenCalledWith('DELETE', '/registry');
	});

	it('unseedAll with confirm deletes all databases except _users', async () => {
		const mockReq = vi.fn().mockImplementation(async (method: string, path: string) => {
			if (path === '/_all_dbs') {
				return { status: 200, data: ['_users', 'registry', 'shelter_sh001'] };
			}
			if (method === 'DELETE') {
				return { status: 200, data: { ok: true } };
			}
			return { status: 200, data: null };
		});

		const result = await unseedAll({ confirm: true, req: mockReq });
		expect(result.dbs).toEqual(['registry', 'shelter_sh001']);
		expect(mockReq).toHaveBeenCalledWith('DELETE', '/registry');
		expect(mockReq).toHaveBeenCalledWith('DELETE', '/shelter_sh001');
		expect(mockReq).not.toHaveBeenCalledWith('DELETE', '/_users');
	});
});
