// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInMemoryRepository } from '$lib/db/in-memory-repository';

vi.mock('$lib/db/shelter', () => ({
	SHELTER_CODE: 'SH001',
	SHELTER_DB: 'shelter_sh001',
	getShelterDb: () => 'shelter_sh001'
}));

let memoryRepo = createInMemoryRepository();
vi.mock('$lib/db/repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/repository')>();
	return { ...actual, createRemoteRepository: () => memoryRepo };
});

import { CatalogRemoteRepository } from './catalog.remote';
import type { AuthorContext } from '$lib/db/model';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'tester' };

describe('CatalogRemoteRepository.deleteRecipe', () => {
	let repo: CatalogRemoteRepository;

	beforeEach(async () => {
		memoryRepo = createInMemoryRepository();
		repo = new CatalogRemoteRepository();
	});

	it('should delete recipe physically if not used by any meal plan', async () => {
		// 1. Create a recipe
		const recipe = await repo.createRecipe(
			{
				label: 'ข้าวผัด',
				ingredients: [{ item_master_id: 'item_1', quantity: '10', uom: 'kg' }],
				standard_portions: '100',
				standard_duration_hours: '1'
			},
			ctx
		);

		expect(recipe._id).toBeDefined();

		// Verify it is in DB
		const foundBefore = await repo.getRecipe(recipe._id);
		expect(foundBefore).not.toBeNull();

		// 2. Delete recipe
		const wasDeleted = await repo.deleteRecipe(recipe._id);
		expect(wasDeleted).toBe(true);

		// Verify it is removed from DB
		const foundAfter = await repo.getRecipe(recipe._id);
		expect(foundAfter).toBeNull();
	});

	it('should deactivate recipe if it is used by a meal plan', async () => {
		// 1. Create a recipe
		const recipe = await repo.createRecipe(
			{
				label: 'ข้าวต้ม',
				ingredients: [{ item_master_id: 'item_1', quantity: '10', uom: 'kg' }],
				standard_portions: '100',
				standard_duration_hours: '1'
			},
			ctx
		);

		// 2. Simulate a meal plan using this recipe in the shelter DB
		await memoryRepo.put({
			_id: 'meal_plan:some-ulid',
			type: 'meal_plan',
			date: '2026-08-05',
			meal: 'breakfast',
			recipes: [{ recipe_id: recipe._id, planned_qty: 100 }],
			status: 'confirmed'
		});

		// 3. Delete recipe
		const wasDeleted = await repo.deleteRecipe(recipe._id);
		expect(wasDeleted).toBe(false); // Should return false because it is deactivated, not deleted

		// 4. Verify it is still in DB but marked deactivated
		const found = await repo.getRecipe(recipe._id);
		expect(found).not.toBeNull();
		expect(found?.deactivated).toBe(true);
	});
});
