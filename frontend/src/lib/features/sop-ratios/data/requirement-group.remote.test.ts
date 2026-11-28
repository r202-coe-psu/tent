import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Repository } from '$lib/db/repository';

const repos = vi.hoisted(() => new Map<string, unknown>());
vi.mock('$lib/db/repository', () => ({
	createRemoteRepository: (name: string) => repos.get(name)
}));

import { RequirementGroupRemoteRepository } from './requirement-group.remote';

function fakeRepo(): Repository {
	return {
		get: vi.fn().mockResolvedValue(null),
		put: vi.fn(async (doc: unknown) => doc),
		allByType: vi.fn().mockResolvedValue([])
	} as unknown as Repository;
}

describe('RequirementGroupRemoteRepository (#936)', () => {
	let catalog: Repository;
	beforeEach(() => {
		catalog = fakeRepo();
		repos.clear();
		repos.set('catalog', catalog);
	});

	it('save persists conversion_factor/share_percent as qty_str with schema_v 2', async () => {
		const saved = await new RequirementGroupRemoteRepository().save(
			'requirement_group:FOOD_PROTEIN',
			{
				name: 'โปรตีน',
				standard_uom: 'gram',
				status: 'active',
				source: 'SPHERE_BASELINE',
				item_maps: [
					{
						item_id: 'item_master:egg',
						base_uom: 'egg',
						conversion_factor: '6.30001',
						share_percent: '50'
					},
					{ item_id: 'item_master:fish', base_uom: 'can', conversion_factor: '12.12345' }
				]
			},
			{ createdBy: 'tester' }
		);
		expect(catalog.put).toHaveBeenCalledOnce();
		expect(saved.schema_v).toBe(2);
		expect(saved.item_maps).toEqual([
			{
				item_id: 'item_master:egg',
				base_uom: 'egg',
				conversion_factor: '6.3',
				share_percent: '50'
			},
			{ item_id: 'item_master:fish', base_uom: 'can', conversion_factor: '12.1235' }
		]);
	});

	it('replaces the maps and clears a previously persisted share', async () => {
		let stored: { _id: string; [key: string]: unknown } = {
			_id: 'requirement_group:X',
			_rev: '1-a',
			item_maps: [{ item_id: 'i', base_uom: 'kg', conversion_factor: '1', share_percent: '40' }]
		};
		vi.mocked(catalog.get).mockImplementation(async () => stored);
		vi.mocked(catalog.put).mockImplementation(async (doc) => {
			stored = doc;
			return doc;
		});
		const repo = new RequirementGroupRemoteRepository();
		await repo.save(
			'requirement_group:X',
			{
				name: 'X',
				standard_uom: 'kg',
				status: 'active',
				source: 'SPHERE_BASELINE',
				item_maps: [{ item_id: 'i', base_uom: 'kg', conversion_factor: '1' }]
			},
			{ createdBy: 'tester' }
		);
		const reloaded = await repo.get('requirement_group:X');
		expect(reloaded?.item_maps?.[0]).not.toHaveProperty('share_percent');
	});

	it('listAll rounds legacy numeric docs and defaults status', async () => {
		vi.mocked(catalog.allByType).mockResolvedValue([
			{
				_id: 'requirement_group:X',
				type: 'requirement_group',
				schema_v: 1,
				name: 'X',
				standard_uom: 'kcal',
				item_maps: [{ item_id: 'i', base_uom: 'kg', conversion_factor: 6.33333, share_percent: 50 }]
			} as never
		]);
		const [doc] = await new RequirementGroupRemoteRepository().listAll();
		expect(doc.status).toBe('active');
		expect(doc.item_maps?.[0]).toMatchObject({ conversion_factor: '6.3333', share_percent: '50' });
	});

	it('listAllStrict merges effective shelter overrides and propagates read failures', async () => {
		const shelterRepo = fakeRepo();
		repos.set('shelter_sh001', shelterRepo);
		vi.mocked(catalog.allByType).mockResolvedValue([
			{
				_id: 'requirement_group:BASE',
				type: 'requirement_group',
				schema_v: 2,
				name: 'baseline',
				standard_uom: 'gram',
				item_maps: [{ item_id: 'item_master:rice', base_uom: 'g', conversion_factor: '1' }],
				source: 'SPHERE_BASELINE'
			} as never
		]);
		vi.mocked(shelterRepo.allByType).mockResolvedValue([
			{
				_id: 'requirement_group:BASE',
				type: 'requirement_group',
				schema_v: 2,
				name: 'override',
				standard_uom: 'gram',
				item_maps: [{ item_id: 'item_master:egg', base_uom: 'piece', conversion_factor: '6.3' }],
				source: 'SHELTER_OVERRIDE'
			} as never
		]);

		const groups = await new RequirementGroupRemoteRepository().listAllStrict('SH001');
		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({ name: 'override', source: 'SHELTER_OVERRIDE' });

		vi.mocked(shelterRepo.allByType).mockRejectedValueOnce(new Error('forbidden'));
		await expect(new RequirementGroupRemoteRepository().listAllStrict('SH001')).rejects.toThrow(
			'forbidden'
		);
	});
});
