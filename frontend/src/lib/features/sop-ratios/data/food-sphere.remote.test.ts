import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Repository } from '$lib/db/repository';

const repos = vi.hoisted(() => new Map<string, unknown>());
vi.mock('$lib/db/repository', () => ({
	createRemoteRepository: (name: string) => repos.get(name)
}));

import { FoodSphereRemoteRepository } from './food-sphere.remote';

function fakeRepo(overrides: Partial<Repository> = {}): Repository {
	return {
		get: vi.fn().mockResolvedValue(null),
		put: vi.fn(async (doc: unknown) => doc),
		allByType: vi.fn().mockResolvedValue([]),
		...overrides
	} as unknown as Repository;
}

describe('FoodSphereRemoteRepository (#936)', () => {
	let catalog: Repository;
	beforeEach(() => {
		catalog = fakeRepo();
		repos.clear();
		repos.set('catalog', catalog);
	});

	it('save persists daily_demand as a rounded qty_str with schema_v 3', async () => {
		const saved = await new FoodSphereRemoteRepository().save(
			'food_sphere_standard:ALL:FOOD_ENERGY',
			{
				target_segment: 'ALL',
				req_group_id: 'FOOD_ENERGY',
				daily_demand: '2100.12345',
				effective_date: '2026-07-16',
				status: 'active',
				source: 'SPHERE_BASELINE'
			},
			{ createdBy: 'tester' }
		);
		expect(catalog.put).toHaveBeenCalledOnce();
		expect(saved.daily_demand).toBe('2100.1235');
		expect(typeof saved.daily_demand).toBe('string');
		expect(saved.schema_v).toBe(3);
	});

	it('listAll rounds legacy numeric docs and defaults status', async () => {
		vi.mocked(catalog.allByType).mockResolvedValue([
			{
				_id: 'food_sphere_standard:ALL:X',
				type: 'food_sphere_standard',
				schema_v: 2,
				target_segment: 'ALL',
				req_group_id: 'X',
				daily_demand: 6.33333,
				effective_date: '2026-07-16'
			} as never
		]);
		const [doc] = await new FoodSphereRemoteRepository().listAll();
		expect(doc.daily_demand).toBe('6.3333');
		expect(doc.status).toBe('active');
	});
});
