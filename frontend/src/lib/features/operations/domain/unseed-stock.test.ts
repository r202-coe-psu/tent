import { describe, expect, it, vi } from 'vitest';
import {
	CATALOG_DB,
	CATALOG_ITEM_PREFIXES,
	findCatalogItemDocs,
	findDocsByPrefix,
	findDocsByPrefixAndType,
	findStockDocsInDb,
	listShelterDatabases,
	parseShelterFlag,
	resolveShelterTarget,
	STOCK_DOC_PREFIXES,
	unseedStock
} from '../../../../../scripts/unseed-stock';

describe('unseed-stock helpers', () => {
	it('parseShelterFlag reads --shelter=value and --shelter value', () => {
		expect(parseShelterFlag(['node', 'x', '--shelter=SH001'])).toBe('SH001');
		expect(parseShelterFlag(['node', 'x', '--shelter', 'all'])).toBe('all');
		expect(parseShelterFlag(['node', 'x', '--confirm'])).toBeNull();
		expect(parseShelterFlag(['node', 'x', '--shelter='])).toBeNull();
	});

	it('resolveShelterTarget maps code, db name, and all', () => {
		expect(resolveShelterTarget('all')).toEqual({ all: true });
		expect(resolveShelterTarget('ALL')).toEqual({ all: true });
		expect(resolveShelterTarget('SH001')).toEqual({ all: false, db: 'shelter_sh001' });
		expect(resolveShelterTarget('sh002')).toEqual({ all: false, db: 'shelter_sh002' });
		expect(resolveShelterTarget('shelter_sh003')).toEqual({ all: false, db: 'shelter_sh003' });
	});

	it('listShelterDatabases keeps only shelter_* names', async () => {
		const mockReq = vi.fn().mockResolvedValue({
			status: 200,
			data: ['_users', 'registry', 'shelter_sh002', 'catalog', 'shelter_sh001']
		});
		await expect(listShelterDatabases(mockReq)).resolves.toEqual([
			'shelter_sh001',
			'shelter_sh002'
		]);
	});

	it('findDocsByPrefix returns matching id/rev pairs', async () => {
		const mockReq = vi.fn().mockResolvedValue({
			status: 200,
			data: {
				rows: [
					{ id: 'stock_ledger:a', value: { rev: '1-a' } },
					{ id: 'stock_ledger:b', value: { rev: '2-b' } },
					{ id: 'other:x', value: { rev: '1-x' } }
				]
			}
		});
		const docs = await findDocsByPrefix('shelter_sh001', 'stock_ledger:', mockReq);
		expect(docs).toEqual([
			{ id: 'stock_ledger:a', rev: '1-a' },
			{ id: 'stock_ledger:b', rev: '2-b' }
		]);
		expect(mockReq).toHaveBeenCalledWith(
			'GET',
			expect.stringMatching(/\/shelter_sh001\/_all_docs\?startkey=.*endkey=/)
		);
	});

	it('findDocsByPrefixAndType keeps only matching type', async () => {
		const mockReq = vi.fn().mockResolvedValue({
			status: 200,
			data: {
				rows: [
					{
						id: 'item:egg',
						value: { rev: '1-a' },
						doc: { _id: 'item:egg', _rev: '1-a', type: 'supply_item', name: 'ไข่ไก่' }
					},
					{
						id: 'item:other',
						value: { rev: '1-b' },
						doc: { _id: 'item:other', _rev: '1-b', type: 'something_else' }
					}
				]
			}
		});
		const docs = await findDocsByPrefixAndType('catalog', 'item:', 'supply_item', mockReq);
		expect(docs).toEqual([{ id: 'item:egg', rev: '1-a' }]);
		expect(mockReq).toHaveBeenCalledWith(
			'GET',
			expect.stringMatching(/include_docs=true/)
		);
	});

	it('findStockDocsInDb unions all stock prefixes including item_master', async () => {
		const mockReq = vi.fn().mockImplementation(async (_method: string, path: string) => {
			if (path.includes(encodeURIComponent(JSON.stringify('stock_ledger:')))) {
				return {
					status: 200,
					data: { rows: [{ id: 'stock_ledger:1', value: { rev: '1-a' } }] }
				};
			}
			if (path.includes(encodeURIComponent(JSON.stringify('stock_threshold_override:')))) {
				return {
					status: 200,
					data: {
						rows: [{ id: 'stock_threshold_override:sh001:rice', value: { rev: '1-b' } }]
					}
				};
			}
			if (path.includes(encodeURIComponent(JSON.stringify('stock_lot_reservation:')))) {
				return { status: 200, data: { rows: [] } };
			}
			if (path.includes(encodeURIComponent(JSON.stringify('item_master:')))) {
				return {
					status: 200,
					data: { rows: [{ id: 'item_master:egg', value: { rev: '1-c' } }] }
				};
			}
			return { status: 200, data: { rows: [] } };
		});

		const docs = await findStockDocsInDb('shelter_sh001', mockReq);
		expect(docs).toEqual([
			{ id: 'stock_ledger:1', rev: '1-a' },
			{ id: 'stock_threshold_override:sh001:rice', rev: '1-b' },
			{ id: 'item_master:egg', rev: '1-c' }
		]);
		expect(STOCK_DOC_PREFIXES).toHaveLength(4);
		expect(STOCK_DOC_PREFIXES).toContain('item_master:');
		expect(mockReq).toHaveBeenCalledTimes(4);
	});

	it('findCatalogItemDocs returns masters + supply_item only', async () => {
		const mockReq = vi.fn().mockImplementation(async (_method: string, path: string) => {
			if (path.includes(encodeURIComponent(JSON.stringify('item_master:')))) {
				return {
					status: 200,
					data: { rows: [{ id: 'item_master:egg', value: { rev: '1-m' } }] }
				};
			}
			if (path.includes(encodeURIComponent(JSON.stringify('item:'))) && path.includes('include_docs')) {
				return {
					status: 200,
					data: {
						rows: [
							{
								id: 'item:legacy-egg',
								value: { rev: '1-s' },
								doc: { _rev: '1-s', type: 'supply_item' }
							}
						]
					}
				};
			}
			return { status: 200, data: { rows: [] } };
		});

		const docs = await findCatalogItemDocs(mockReq);
		expect(docs).toEqual([
			{ id: 'item_master:egg', rev: '1-m' },
			{ id: 'item:legacy-egg', rev: '1-s' }
		]);
		expect(CATALOG_ITEM_PREFIXES).toEqual(['item_master:', 'item:']);
	});
});

describe('unseedStock', () => {
	it('dry-run lists shelter + catalog docs and does not write', async () => {
		const mockReq = vi.fn().mockImplementation(async (method: string, path: string) => {
			if (path === '/_all_dbs') {
				return { status: 200, data: ['shelter_sh001', 'registry', 'catalog'] };
			}
			if (path.includes('/shelter_sh001/') && path.includes('stock_ledger')) {
				return {
					status: 200,
					data: { rows: [{ id: 'stock_ledger:seed', value: { rev: '1-x' } }] }
				};
			}
			if (path.includes('/catalog/') && path.includes('item_master')) {
				return {
					status: 200,
					data: { rows: [{ id: 'item_master:egg', value: { rev: '1-y' } }] }
				};
			}
			if (
				path.includes('/catalog/') &&
				path.includes(encodeURIComponent(JSON.stringify('item:'))) &&
				path.includes('include_docs')
			) {
				return {
					status: 200,
					data: {
						rows: [
							{
								id: 'item:egg',
								value: { rev: '1-z' },
								doc: { _rev: '1-z', type: 'supply_item' }
							}
						]
					}
				};
			}
			if (path.includes('_all_docs')) {
				return { status: 200, data: { rows: [] } };
			}
			return { status: 200, data: null };
		});

		const result = await unseedStock({
			shelter: 'SH001',
			confirm: false,
			req: mockReq,
			displayUrl: 'http://admin:***@localhost:5984'
		});

		expect(result.dbs).toEqual(['shelter_sh001', CATALOG_DB]);
		expect(result.docsByDb.shelter_sh001).toEqual(['stock_ledger:seed']);
		expect(result.docsByDb.catalog).toEqual(['item_master:egg', 'item:egg']);
		expect(mockReq.mock.calls.some(([m]) => m === 'POST' || m === 'DELETE')).toBe(false);
	});

	it('confirm bulk-deletes stock docs for one shelter and catalog items', async () => {
		const mockReq = vi.fn().mockImplementation(async (method: string, path: string) => {
			if (path === '/_all_dbs') {
				return { status: 200, data: ['shelter_sh001', 'shelter_sh002', 'catalog'] };
			}
			if (path.includes('/shelter_sh001/') && path.includes('stock_ledger')) {
				return {
					status: 200,
					data: { rows: [{ id: 'stock_ledger:a', value: { rev: '1-a' } }] }
				};
			}
			if (path.includes('/catalog/') && path.includes('item_master')) {
				return {
					status: 200,
					data: { rows: [{ id: 'item_master:egg', value: { rev: '1-m' } }] }
				};
			}
			if (path.includes('_all_docs')) {
				return { status: 200, data: { rows: [] } };
			}
			if (method === 'POST' && path.endsWith('/_bulk_docs')) {
				return { status: 201, data: [{ ok: true }] };
			}
			return { status: 200, data: null };
		});

		const result = await unseedStock({
			shelter: 'SH001',
			confirm: true,
			req: mockReq,
			displayUrl: 'http://admin:***@localhost:5984'
		});

		expect(result.dbs).toEqual(['shelter_sh001', CATALOG_DB]);
		expect(mockReq).toHaveBeenCalledWith('POST', '/shelter_sh001/_bulk_docs', {
			docs: [{ _id: 'stock_ledger:a', _rev: '1-a', _deleted: true }]
		});
		expect(mockReq).toHaveBeenCalledWith('POST', '/catalog/_bulk_docs', {
			docs: [{ _id: 'item_master:egg', _rev: '1-m', _deleted: true }]
		});
		expect(mockReq).not.toHaveBeenCalledWith(
			'POST',
			'/shelter_sh002/_bulk_docs',
			expect.anything()
		);
	});

	it('confirm with --shelter=all deletes across every shelter db and catalog', async () => {
		const mockReq = vi.fn().mockImplementation(async (method: string, path: string) => {
			if (path === '/_all_dbs') {
				return { status: 200, data: ['shelter_sh001', 'shelter_sh002', 'catalog'] };
			}
			if (path.includes('/shelter_sh001/') && path.includes('stock_ledger')) {
				return {
					status: 200,
					data: { rows: [{ id: 'stock_ledger:one', value: { rev: '1-1' } }] }
				};
			}
			if (path.includes('/shelter_sh002/') && path.includes('stock_ledger')) {
				return {
					status: 200,
					data: { rows: [{ id: 'stock_ledger:two', value: { rev: '1-2' } }] }
				};
			}
			if (path.includes('/catalog/') && path.includes('item_master')) {
				return {
					status: 200,
					data: { rows: [{ id: 'item_master:rice', value: { rev: '1-r' } }] }
				};
			}
			if (path.includes('_all_docs')) {
				return { status: 200, data: { rows: [] } };
			}
			if (method === 'POST' && path.endsWith('/_bulk_docs')) {
				return { status: 201, data: [{ ok: true }] };
			}
			return { status: 200, data: null };
		});

		const result = await unseedStock({
			shelter: 'all',
			confirm: true,
			req: mockReq,
			displayUrl: 'http://admin:***@localhost:5984'
		});

		expect(result.dbs).toEqual(['shelter_sh001', 'shelter_sh002', CATALOG_DB]);
		expect(mockReq).toHaveBeenCalledWith('POST', '/shelter_sh001/_bulk_docs', {
			docs: [{ _id: 'stock_ledger:one', _rev: '1-1', _deleted: true }]
		});
		expect(mockReq).toHaveBeenCalledWith('POST', '/shelter_sh002/_bulk_docs', {
			docs: [{ _id: 'stock_ledger:two', _rev: '1-2', _deleted: true }]
		});
		expect(mockReq).toHaveBeenCalledWith('POST', '/catalog/_bulk_docs', {
			docs: [{ _id: 'item_master:rice', _rev: '1-r', _deleted: true }]
		});
	});

	it('throws when a named shelter database is missing', async () => {
		const mockReq = vi.fn().mockResolvedValue({
			status: 200,
			data: ['shelter_sh001']
		});
		await expect(
			unseedStock({ shelter: 'SH999', confirm: false, req: mockReq })
		).rejects.toThrow(/shelter_sh999/);
	});
});
