import { describe, it, expect, vi, beforeEach } from 'vitest';
import { seedSystemItemCategories } from '../../../../../scripts/seed/master-seed';
import { SYSTEM_CATEGORY_DEFINITIONS } from '$lib/features/catalog/domain/catalog';
import * as couch from '../../../../../scripts/seed/couch';

vi.mock('../../../../../scripts/seed/couch', () => ({
	couchReq: vi.fn(),
	putDoc: vi.fn(),
	ensureDb: vi.fn(),
	setSecurity: vi.fn(),
	bulkDocs: vi.fn(),
	displayCouchUrl: vi.fn(() => 'http://localhost:5984')
}));

describe('CR-119: System Item Category Seed & Migration', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('creates all 10 system categories when catalog is empty', async () => {
		const mockedCouchReq = vi.mocked(couch.couchReq);
		const mockedPutDoc = vi.mocked(couch.putDoc);

		// All GETs return 404
		mockedCouchReq.mockResolvedValue({ status: 404, data: null });
		mockedPutDoc.mockResolvedValue();

		const result = await seedSystemItemCategories();

		expect(result).toEqual({ created: 10, updated: 0, skipped: 0 });
		expect(mockedPutDoc).toHaveBeenCalledTimes(10);

		// Verify every system category was created with schema_v: 2 and is_protected: true
		for (const def of SYSTEM_CATEGORY_DEFINITIONS) {
			expect(mockedPutDoc).toHaveBeenCalledWith(
				'catalog',
				expect.objectContaining({
					_id: def.id,
					type: 'item_category',
					schema_v: 2,
					system_key: def.key,
					default_class: def.default_class,
					is_protected: true
				})
			);
		}
	});

	it('skips all 10 categories on rerun when no drift exists', async () => {
		const mockedCouchReq = vi.mocked(couch.couchReq);
		const mockedPutDoc = vi.mocked(couch.putDoc);

		mockedCouchReq.mockImplementation(async (_method, path) => {
			const id = decodeURIComponent(path.replace('/catalog/', ''));
			const def = SYSTEM_CATEGORY_DEFINITIONS.find((d) => d.id === id);
			if (!def) return { status: 404, data: null };

			return {
				status: 200,
				data: {
					_id: def.id,
					type: 'item_category',
					schema_v: 2,
					system_key: def.key,
					name: def.name,
					default_class: def.default_class,
					description: def.description,
					is_protected: true
				}
			};
		});

		const result = await seedSystemItemCategories();

		expect(result).toEqual({ created: 0, updated: 0, skipped: 10 });
		expect(mockedPutDoc).not.toHaveBeenCalled();
	});

	it('repairs invariant drift while preserving system admin name and description', async () => {
		const mockedCouchReq = vi.mocked(couch.couchReq);

		mockedCouchReq.mockImplementation(async (method, path) => {
			if (method === 'PUT') {
				return { status: 200, data: { ok: true } };
			}
			const id = decodeURIComponent(path.replace('/catalog/', ''));
			const def = SYSTEM_CATEGORY_DEFINITIONS.find((d) => d.id === id);
			if (!def) return { status: 404, data: null };

			if (def.key === 'BEDDING') {
				// Simulating legacy/drift document with custom name/description from SA
				return {
					status: 200,
					data: {
						_id: def.id,
						type: 'item_category',
						schema_v: 1, // Stale schema
						system_key: 'BEDDING',
						name: 'เครื่องนอนเฉพาะกิจ (SA Custom Name)',
						default_class: 'CONSUMABLE', // Drift (should be DURABLE)
						description: 'คำอธิบายพิเศษโดย SA',
						is_protected: false // Drift
					}
				};
			}

			// Others are current
			return {
				status: 200,
				data: {
					_id: def.id,
					type: 'item_category',
					schema_v: 2,
					system_key: def.key,
					name: def.name,
					default_class: def.default_class,
					description: def.description,
					is_protected: true
				}
			};
		});

		const result = await seedSystemItemCategories();

		expect(result).toEqual({ created: 0, updated: 1, skipped: 9 });

		// Verify the PUT repair call preserved SA name and description while repairing invariants
		expect(mockedCouchReq).toHaveBeenCalledWith(
			'PUT',
			'/catalog/item_category%3Abedding',
			expect.objectContaining({
				_id: 'item_category:bedding',
				schema_v: 2,
				default_class: 'DURABLE',
				is_protected: true,
				name: 'เครื่องนอนเฉพาะกิจ (SA Custom Name)',
				description: 'คำอธิบายพิเศษโดย SA'
			})
		);
	});

	it('fails loudly when a deterministic ID is occupied by an unexpected document type', async () => {
		const mockedCouchReq = vi.mocked(couch.couchReq);

		mockedCouchReq.mockResolvedValue({
			status: 200,
			data: {
				_id: 'item_category:food',
				type: 'item_master',
				name: 'ข้าวสาร'
			}
		});

		await expect(seedSystemItemCategories()).rejects.toThrow(
			/occupied by unexpected document type/
		);
	});

	it('fails loudly when CouchDB returns an unexpected HTTP status', async () => {
		const mockedCouchReq = vi.mocked(couch.couchReq);

		mockedCouchReq.mockResolvedValue({
			status: 500,
			data: { error: 'internal_server_error' }
		});

		await expect(seedSystemItemCategories()).rejects.toThrow(/Unexpected status 500/);
	});
});
