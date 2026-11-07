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

	it('listAll normalizes legacy numeric docs losslessly and defaults status', async () => {
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
		expect(doc.item_maps?.[0]).toMatchObject({ conversion_factor: '6.33333', share_percent: '50' });
	});
});
