import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FALLBACK_UNIT_DEFINITIONS } from './unit-of-measure';

const couch = vi.hoisted(() => ({
	request: vi.fn(),
	ensureDb: vi.fn(),
	putDoc: vi.fn(),
	setSecurity: vi.fn()
}));

vi.mock('../../../../../scripts/seed/couch', () => ({
	bulkDocs: vi.fn(),
	couchReq: couch.request,
	ensureDb: couch.ensureDb,
	putDoc: couch.putDoc,
	setSecurity: couch.setSecurity
}));

import {
	assertItemMasterSeedUomCodes,
	seedCatalog,
	seedCatalogFoodSphereParameters,
	seedCatalogUnitOfMeasures
} from '../../../../../scripts/seed/master-seed';

describe('master seed unit-of-measure provisioning', () => {
	beforeEach(() => {
		couch.request.mockReset();
		couch.ensureDb.mockReset();
		couch.putDoc.mockReset();
		couch.setSecurity.mockReset();
	});

	it('creates all canonical units when the catalog is missing them', async () => {
		const writes: Record<string, unknown>[] = [];
		couch.request.mockImplementation(async (method: string, _path: string, body?: unknown) => {
			if (method === 'GET') return { status: 404, data: { error: 'not_found' } };
			writes.push(body as Record<string, unknown>);
			return { status: 201, data: { ok: true } };
		});

		expect(await seedCatalogUnitOfMeasures()).toBe(FALLBACK_UNIT_DEFINITIONS.length);
		expect(writes).toHaveLength(FALLBACK_UNIT_DEFINITIONS.length);
		expect(writes.map((doc) => doc._id)).toEqual(
			FALLBACK_UNIT_DEFINITIONS.map((unit) => `unit_of_measure:${unit.code}`)
		);
		expect(writes.every((doc) => doc.type === 'unit_of_measure' && doc.schema_v === 1)).toBe(true);
	});

	it('preserves operator metadata while enforcing canonical protected fields', async () => {
		const first = FALLBACK_UNIT_DEFINITIONS[0];
		const existing = {
			_id: `unit_of_measure:${first.code}`,
			_rev: '3-test',
			type: 'unit_of_measure',
			code: first.code,
			created_at: '2026-09-22T00:00:00.000Z',
			updated_at: '2026-09-22T00:00:00.000Z',
			created_by: 'system_admin',
			label_th: 'ชื่อที่ผู้ดูแลแก้ไข',
			label_en: 'custom label',
			dimension: first.dimension,
			is_protected: false,
			sort_order: 99,
			deactivated: true
		};
		const writes: Record<string, unknown>[] = [];
		let firstRead = true;
		couch.request.mockImplementation(async (method: string, _path: string, body?: unknown) => {
			if (method === 'GET') {
				if (firstRead) {
					firstRead = false;
					return { status: 200, data: existing };
				}
				return { status: 404, data: { error: 'not_found' } };
			}
			writes.push(body as Record<string, unknown>);
			return { status: 201, data: { ok: true } };
		});

		await seedCatalogUnitOfMeasures();

		expect(writes[0]).toMatchObject({
			_id: existing._id,
			_rev: existing._rev,
			label_th: existing.label_th,
			label_en: existing.label_en,
			sort_order: existing.sort_order,
			deactivated: existing.deactivated,
			code: first.code,
			dimension: first.dimension,
			is_protected: true
		});
	});

	it('retries a conflicting write with the latest revision', async () => {
		const first = FALLBACK_UNIT_DEFINITIONS[0];
		const winner = {
			_id: `unit_of_measure:${first.code}`,
			_rev: '4-test',
			type: 'unit_of_measure',
			code: first.code,
			created_at: '2026-09-22T00:00:00.000Z',
			updated_at: '2026-09-22T00:00:00.000Z',
			created_by: 'system_admin',
			label_th: first.label_th,
			label_en: first.label_en,
			dimension: first.dimension,
			is_protected: true
		};
		const queuedResponses = [
			{ status: 404, data: { error: 'not_found' } },
			{ status: 409, data: { error: 'conflict' } },
			{ status: 200, data: winner },
			{ status: 201, data: { ok: true } }
		];
		const writes: Record<string, unknown>[] = [];
		couch.request.mockImplementation(async (method: string, _path: string, body?: unknown) => {
			if (method === 'PUT') writes.push(body as Record<string, unknown>);
			return (
				queuedResponses.shift() ??
				(method === 'GET'
					? { status: 404, data: { error: 'not_found' } }
					: { status: 201, data: { ok: true } })
			);
		});

		await seedCatalogUnitOfMeasures();

		expect(writes[1]).toMatchObject({ _rev: winner._rev, _id: winner._id });
	});

	it('fails without writing when a UOM read returns an unexpected status', async () => {
		couch.request.mockResolvedValue({ status: 503, data: { error: 'unavailable' } });

		await expect(seedCatalogUnitOfMeasures()).rejects.toThrow('HTTP 503');
		expect(couch.request).toHaveBeenCalledTimes(1);
	});

	it('rejects an existing UOM with a malformed common envelope', async () => {
		const first = FALLBACK_UNIT_DEFINITIONS[0];
		couch.request.mockResolvedValue({
			status: 200,
			data: {
				_id: `unit_of_measure:${first.code}`,
				_rev: '5-test',
				type: 'unit_of_measure',
				code: first.code,
				dimension: first.dimension,
				created_by: 'system_admin'
			}
		});

		await expect(seedCatalogUnitOfMeasures()).rejects.toThrow('invalid created_at');
		expect(couch.request).toHaveBeenCalledTimes(1);
	});

	it('validates canonical, custom, and unsupported item-master UOM values', () => {
		expect(() =>
			assertItemMasterSeedUomCodes(
				{
					_id: 'item_master:test',
					name: 'ข้าวสาร',
					base_unit: 'kg',
					default_inventory_uom: 'case',
					default_issue_uom: 'kg',
					conversions: [{ uom_name: 'bag', multiplier: '50' }]
				},
				new Set(['case'])
			)
		).not.toThrow();

		expect(() =>
			assertItemMasterSeedUomCodes({
				_id: 'item_master:test',
				name: 'ข้าวสาร',
				base_unit: 'kg',
				default_inventory_uom: 'กระสอบ 50 กก.'
			})
		).toThrow('Invalid UOM code');
	});

	it('writes item-master packaging as UOM codes and normalizes legacy defaults', async () => {
		const existingRows = [
			{
				doc: {
					_id: 'unit_of_measure:case',
					type: 'unit_of_measure',
					code: 'case'
				}
			},
			{
				doc: {
					_id: 'item_master:01ARZ3NDEKTSV4RRFFQ69G5FAV',
					_rev: '2-rice',
					type: 'item_master',
					name: 'ข้าวสาร',
					base_unit: 'กิโลกรัม',
					default_inventory_uom: 'กระสอบ 50 กก.',
					default_issue_uom: 'kg',
					conversions: [
						{ uom_name: 'ถุง 5 กก.', multiplier: '5' },
						{ uom_name: 'กระสอบ 50 กก.', multiplier: '50' }
					]
				}
			},
			{
				doc: {
					_id: 'item_master:01ARZ3NDEKTSV4RRFFQ69G5FAW',
					_rev: '3-egg',
					type: 'item_master',
					name: 'ไข่ไก่',
					base_unit: 'piece',
					default_inventory_uom: 'case',
					default_issue_uom: 'piece',
					conversions: [{ uom_name: ' case ', multiplier: '30' }]
				}
			},
			{
				doc: {
					_id: 'item_master:01ARZ3NDEKTSV4RRFFQ69G5FAX',
					_rev: '4-vest',
					type: 'item_master',
					name: 'เสื้อกั๊กสะท้อนแสง',
					base_unit: 'piece',
					default_inventory_uom: 'case',
					default_issue_uom: 'case'
				}
			}
		];
		couch.request.mockImplementation(async (method: string, path: string) => {
			if (method === 'GET' && path === '/catalog/_all_docs?include_docs=true') {
				return { status: 200, data: { rows: existingRows } };
			}
			if (method === 'GET') return { status: 404, data: { error: 'not_found' } };
			return { status: 201, data: { ok: true } };
		});
		couch.putDoc.mockResolvedValue({ ok: true });

		await seedCatalog();

		const itemMasters = couch.putDoc.mock.calls
			.map(([, doc]) => doc as Record<string, unknown>)
			.filter((doc) => doc.type === 'item_master');
		expect(itemMasters).toHaveLength(34);
		const rice = itemMasters.find((doc) => doc.name === 'ข้าวสาร');
		const eggs = itemMasters.find((doc) => doc.name === 'ไข่ไก่');
		const vest = itemMasters.find((doc) => doc.name === 'เสื้อกั๊กสะท้อนแสง');
		const fishSauce = itemMasters.find((doc) => doc.name === 'น้ำปลา');
		const mosquitoNet = itemMasters.find((doc) => doc.name === 'มุ้ง');
		expect(rice).toMatchObject({
			base_unit: 'กิโลกรัม',
			default_inventory_uom: 'bag',
			default_issue_uom: 'kg',
			category: 'item_category:food',
			conversions: [{ uom_name: 'bag', multiplier: '50' }]
		});
		expect(eggs).toMatchObject({
			default_inventory_uom: 'case',
			conversions: [{ uom_name: 'case', multiplier: '30' }]
		});
		expect(vest).toMatchObject({
			default_inventory_uom: 'case',
			default_issue_uom: 'case'
		});
		expect(fishSauce).toMatchObject({ category: 'item_category:food', base_unit: 'bottle' });
		expect(mosquitoNet).toMatchObject({ category: 'item_category:bedding', base_unit: 'piece' });
		const categories = couch.putDoc.mock.calls
			.map(([, doc]) => doc as Record<string, unknown>)
			.filter((doc) => doc.type === 'item_category');
		expect(categories).toHaveLength(10);
		expect(categories.every((doc) => doc.is_protected === true)).toBe(true);
		expect(categories.map((doc) => doc._id).sort()).toEqual(
			[
				'item_category:bedding',
				'item_category:food',
				'item_category:fuel_energy',
				'item_category:kits',
				'item_category:medical',
				'item_category:ready_meal',
				'item_category:special_care',
				'item_category:volunteer_ppe',
				'item_category:wash',
				'item_category:water'
			].sort()
		);
		for (const itemMaster of itemMasters) {
			assertItemMasterSeedUomCodes(itemMaster, new Set(['case']));
		}
	});
});

describe('food sphere seed parameters', () => {
	beforeEach(() => {
		couch.request.mockReset();
		couch.ensureDb.mockReset();
		couch.putDoc.mockReset();
		couch.setSecurity.mockReset();
	});

	it('preserves existing document revisions and resolves item master IDs', async () => {
		const existingRows = [
			{
				doc: {
					_id: 'item_master:01HXYZ1234567890ABCDEFGH01',
					type: 'item_master',
					name: 'ข้าวสาร'
				}
			},
			{
				doc: {
					_id: 'item_master:01HXYZ1234567890ABCDEFGH02',
					type: 'item_master',
					name: 'ไข่ไก่'
				}
			},
			{
				doc: {
					_id: 'item_master:01HXYZ1234567890ABCDEFGH03',
					type: 'item_master',
					name: 'ปลากระป๋อง'
				}
			},
			{
				doc: {
					_id: 'requirement_group:FOOD_PROTEIN',
					_rev: '5-rev-existing-protein',
					type: 'requirement_group'
				}
			},
			{
				doc: {
					_id: 'food_sphere_standard:ALL:FOOD_PROTEIN',
					_rev: '2-rev-existing-standard',
					type: 'food_sphere_standard'
				}
			},
			{
				doc: {
					_id: 'replenishment_policy:REQUIREMENT_GROUP:FOOD_ENERGY',
					_rev: '1-rev-existing-policy',
					type: 'replenishment_policy'
				}
			}
		];

		couch.request.mockImplementation(async (method: string, path: string) => {
			if (method === 'GET' && path === '/catalog/_all_docs?include_docs=true') {
				return { status: 200, data: { rows: existingRows } };
			}
			return { status: 404, data: { error: 'not_found' } };
		});
		couch.putDoc.mockResolvedValue({ ok: true });

		await seedCatalogFoodSphereParameters();

		const writtenDocs = couch.putDoc.mock.calls.map(([, doc]) => doc as Record<string, unknown>);

		// Verify FOOD_PROTEIN has the updated egg + canned fish item mappings and preserved _rev
		const proteinGroup = writtenDocs.find((d) => d._id === 'requirement_group:FOOD_PROTEIN');
		expect(proteinGroup).toBeDefined();
		expect(proteinGroup?._rev).toBe('5-rev-existing-protein');
		expect(proteinGroup?.item_maps).toEqual([
			{
				item_id: 'item_master:01HXYZ1234567890ABCDEFGH02',
				base_uom: 'piece',
				conversion_factor: 6.3,
				share_percent: 50
			},
			{
				item_id: 'item_master:01HXYZ1234567890ABCDEFGH03',
				base_uom: 'can',
				conversion_factor: 17,
				share_percent: 50
			}
		]);

		// Verify standard and policy preserved _rev
		const proteinStandard = writtenDocs.find(
			(d) => d._id === 'food_sphere_standard:ALL:FOOD_PROTEIN'
		);
		expect(proteinStandard?._rev).toBe('2-rev-existing-standard');

		const energyPolicy = writtenDocs.find(
			(d) => d._id === 'replenishment_policy:REQUIREMENT_GROUP:FOOD_ENERGY'
		);
		expect(energyPolicy?._rev).toBe('1-rev-existing-policy');

		// New documents without prior existence should not have _rev
		const halalProtein = writtenDocs.find((d) => d._id === 'requirement_group:FOOD_PROTEIN_HALAL');
		expect(halalProtein?._rev).toBeUndefined();
	});
});
