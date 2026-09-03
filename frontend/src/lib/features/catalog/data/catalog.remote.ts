import { createRemoteRepository, type Repository, type PaginatedResult } from '$lib/db/repository';
import { touch, type AuthorContext } from '$lib/db/model';
import { getShelterDb } from '$lib/db/shelter';
import {
	createItemCategory,
	isItemCategory,
	type ItemCategory,
	type ItemCategoryInput,
	createItemMaster,
	type ItemMaster,
	type ItemMasterInput,
	isItemMaster,
	createRecipe,
	type Recipe,
	type RecipeInput,
	isRecipe
} from '../domain/catalog';
import {
	evaluateCategoryDeletion,
	type CategoryUsageDetails,
	type DeleteCategoryResult,
	type ShelterCategoryUsage
} from '../domain/catalog-deletion';
import { sheltersRepository } from '$lib/features/shelters/data/shelters.remote';
import type { CatalogRepository } from './catalog.repository';

export const CATALOG_DB = 'catalog';

function paginate<T>(items: T[], page: number, pageSize: number): PaginatedResult<T> {
	const total = items.length;
	const totalPages = Math.max(1, Math.ceil(total / pageSize));
	const safePage = Math.max(1, Math.min(page, totalPages));
	const start = (safePage - 1) * pageSize;
	const slicedItems = items.slice(start, start + pageSize);
	return { items: slicedItems, total, page: safePage, pageSize, totalPages };
}

/**
 * Remote CouchDB implementation of the catalog master-data repository.
 * Reads/writes the `catalog` database via the active central endpoint.
 */
export class CatalogRemoteRepository implements CatalogRepository {
	private readonly repo: Repository;

	constructor(dbName: string = CATALOG_DB) {
		this.repo = createRemoteRepository(dbName);
	}

	private getWriteRepo(shelterCode?: string): Repository {
		if (shelterCode) {
			return createRemoteRepository(`shelter_${shelterCode.toLowerCase()}`);
		}
		return this.repo;
	}

	createItemCategory(
		input: ItemCategoryInput,
		ctx: AuthorContext,
		shelterCode?: string
	): Promise<ItemCategory> {
		const repo = this.getWriteRepo(shelterCode);
		return repo.put(createItemCategory(input, ctx, shelterCode));
	}

	async listItemCategories(shelterCode?: string | null): Promise<ItemCategory[]> {
		const centralItems = await this.repo.allByType('item_category', isItemCategory);
		const centralFiltered = centralItems.filter((i) => !i.shelter_code);

		if (shelterCode) {
			const localRepo = createRemoteRepository(`shelter_${shelterCode.toLowerCase()}`);
			const localItems = await localRepo.allByType('item_category', isItemCategory);

			const localMap = new Map(localItems.map((i) => [i._id, i]));
			return [...localItems, ...centralFiltered.filter((i) => !localMap.has(i._id))];
		}
		return centralFiltered;
	}

	async listItemCategoriesPaginated(
		page: number,
		pageSize: number,
		shelterCode?: string | null
	): Promise<PaginatedResult<ItemCategory>> {
		const items = await this.listItemCategories(shelterCode);
		return paginate(items, page, pageSize);
	}

	async getItemCategory(id: string, shelterCode?: string | null): Promise<ItemCategory | null> {
		if (shelterCode) {
			const localRepo = createRemoteRepository(`shelter_${shelterCode.toLowerCase()}`);
			const localDoc = await localRepo.get<ItemCategory>(id);
			if (localDoc) return localDoc;
		}
		return this.repo.get<ItemCategory>(id);
	}

	updateItemCategory(itemCategory: ItemCategory): Promise<ItemCategory> {
		const repo = this.getWriteRepo(itemCategory.shelter_code);
		return repo.put(touch(itemCategory));
	}

	createItemMaster(
		input: ItemMasterInput,
		ctx: AuthorContext,
		shelterCode?: string
	): Promise<ItemMaster> {
		const repo = this.getWriteRepo(shelterCode);
		return repo.put(createItemMaster(input, ctx, shelterCode));
	}

	async listItemMasters(shelterCode?: string | null): Promise<ItemMaster[]> {
		const centralItems = await this.repo.allByType('item_master', isItemMaster);
		const centralFiltered = centralItems.filter((i) => !i.shelter_code);

		if (shelterCode) {
			const localRepo = createRemoteRepository(`shelter_${shelterCode.toLowerCase()}`);
			const localItems = await localRepo.allByType('item_master', isItemMaster);

			const localMap = new Map(localItems.map((i) => [i._id, i]));
			return [...localItems, ...centralFiltered.filter((i) => !localMap.has(i._id))];
		}
		return centralFiltered;
	}

	async listItemMastersPaginated(
		page: number,
		pageSize: number,
		shelterCode?: string | null
	): Promise<PaginatedResult<ItemMaster>> {
		const items = await this.listItemMasters(shelterCode);
		return paginate(items, page, pageSize);
	}

	async getItemMaster(id: string, shelterCode?: string | null): Promise<ItemMaster | null> {
		if (shelterCode) {
			const localRepo = createRemoteRepository(`shelter_${shelterCode.toLowerCase()}`);
			const localDoc = await localRepo.get<ItemMaster>(id);
			if (localDoc) return localDoc;
		}
		return this.repo.get<ItemMaster>(id);
	}

	updateItemMaster(itemMaster: ItemMaster): Promise<ItemMaster> {
		const repo = this.getWriteRepo(itemMaster.shelter_code);
		return repo.put(touch(itemMaster));
	}

	createRecipe(input: RecipeInput, ctx: AuthorContext, shelterCode?: string): Promise<Recipe> {
		const repo = this.getWriteRepo(shelterCode);
		return repo.put(createRecipe(input, ctx, shelterCode));
	}

	async listRecipes(shelterCode?: string | null): Promise<Recipe[]> {
		const centralItems = await this.repo.allByType('recipe', isRecipe);
		const centralFiltered = centralItems.filter((i) => !i.shelter_code);

		if (shelterCode) {
			const localRepo = createRemoteRepository(`shelter_${shelterCode.toLowerCase()}`);
			const localItems = await localRepo.allByType('recipe', isRecipe);

			const localMap = new Map(localItems.map((i) => [i._id, i]));
			return [...localItems, ...centralFiltered.filter((i) => !localMap.has(i._id))];
		}
		return centralFiltered;
	}

	async listRecipesPaginated(
		page: number,
		pageSize: number,
		shelterCode?: string | null
	): Promise<PaginatedResult<Recipe>> {
		const items = await this.listRecipes(shelterCode);
		return paginate(items, page, pageSize);
	}

	async getRecipe(id: string, shelterCode?: string | null): Promise<Recipe | null> {
		if (shelterCode) {
			const localRepo = createRemoteRepository(`shelter_${shelterCode.toLowerCase()}`);
			const localDoc = await localRepo.get<Recipe>(id);
			if (localDoc) return localDoc;
		}
		return this.repo.get<Recipe>(id);
	}

	updateRecipe(recipe: Recipe): Promise<Recipe> {
		const repo = this.getWriteRepo(recipe.shelter_code);
		return repo.put(touch(recipe));
	}

	async deleteItemMaster(id: string, shelterCode?: string | null): Promise<boolean> {
		const item = await this.getItemMaster(id, shelterCode);
		if (!item) return false;

		if (item.override) {
			const repo = this.getWriteRepo(item.shelter_code);
			await repo.remove(item);
			return true;
		}

		const shelterDb = shelterCode ? `shelter_${shelterCode.toLowerCase()}` : getShelterDb();
		const shelterRepo = createRemoteRepository(shelterDb);
		const ledgerEntries = await shelterRepo.allByType(
			'stock_ledger',
			(d): d is { _id: string; type: string; item_id: string } => {
				return !!d && typeof d === 'object' && (d as { type?: unknown }).type === 'stock_ledger';
			}
		);
		const isUsed = ledgerEntries.some((entry) => entry.item_id === id);

		if (isUsed) {
			item.deactivated = true;
			await this.updateItemMaster(item);
			return false;
		} else {
			const repo = this.getWriteRepo(item.shelter_code);
			await repo.remove(item);
			return true;
		}
	}

	async inspectCategoryUsage(
		id: string,
		shelterCode?: string | null
	): Promise<CategoryUsageDetails> {
		const category = await this.getItemCategory(id, shelterCode);
		if (!category) {
			throw new Error(`ไม่พบข้อมูลหมวดหมู่ ${id}`);
		}

		const isOverride = !!category.override;
		const categoryName = category.name;

		if (shelterCode) {
			const itemMasters = await this.listItemMasters(shelterCode);
			const localItems = itemMasters
				.filter((item) => item.category === categoryName)
				.map((item) => item.name);

			return {
				categoryId: id,
				categoryName,
				isOverride,
				shelterCode,
				centralItemMasters: [],
				shelterUsages: [
					{
						shelterCode,
						itemMasters: localItems,
						hasOverride: isOverride
					}
				],
				totalItemCount: localItems.length,
				totalShelterCount: localItems.length > 0 ? 1 : 0
			};
		}

		// Central scope (System Management)
		const centralItems = await this.repo.allByType('item_master', isItemMaster);
		const centralMatching = centralItems
			.filter((item) => !item.shelter_code && item.category === categoryName)
			.map((item) => item.name);

		const shelterUsages: ShelterCategoryUsage[] = [];
		try {
			const shelters = await sheltersRepository().listShelters();
			for (const s of shelters) {
				const shelterDb = `shelter_${s.code.toLowerCase()}`;
				const localRepo = createRemoteRepository(shelterDb);

				const localMasters = await localRepo.allByType('item_master', isItemMaster);
				const matchingMasters = localMasters
					.filter((item) => item.category === categoryName)
					.map((item) => item.name);

				const localCategories = await localRepo.allByType('item_category', isItemCategory);
				const hasOverride = localCategories.some((c) => c._id === id && c.override);

				if (matchingMasters.length > 0 || hasOverride) {
					shelterUsages.push({
						shelterCode: s.code,
						shelterName: s.name,
						itemMasters: matchingMasters,
						hasOverride
					});
				}
			}
		} catch {
			// Fallback to central only if shelters repository is not available
		}

		const totalItemCount =
			centralMatching.length + shelterUsages.reduce((sum, su) => sum + su.itemMasters.length, 0);

		return {
			categoryId: id,
			categoryName,
			isOverride: false,
			shelterCode: null,
			centralItemMasters: centralMatching,
			shelterUsages,
			totalItemCount,
			totalShelterCount: shelterUsages.length
		};
	}

	async deleteItemCategory(id: string, shelterCode?: string | null): Promise<DeleteCategoryResult> {
		const category = await this.getItemCategory(id, shelterCode);
		if (!category) {
			throw new Error(`ไม่พบข้อมูลหมวดหมู่ ${id}`);
		}

		const usage = await this.inspectCategoryUsage(id, shelterCode);
		const decision = evaluateCategoryDeletion(usage, shelterCode ? 'shelter' : 'central');

		if (decision.action === 'reset') {
			const repo = this.getWriteRepo(category.shelter_code);
			await repo.remove(category);
			return {
				wasDeleted: true,
				actionTaken: 'reset',
				categoryName: category.name
			};
		}

		if (decision.action === 'deactivate') {
			category.deactivated = true;
			await this.updateItemCategory(category);
			return {
				wasDeleted: false,
				actionTaken: 'deactivate',
				categoryName: category.name
			};
		}

		// hard_delete
		const repo = this.getWriteRepo(category.shelter_code);
		await repo.remove(category);
		return {
			wasDeleted: true,
			actionTaken: 'hard_delete',
			categoryName: category.name
		};
	}

	async deleteRecipe(id: string, shelterCode?: string | null): Promise<boolean> {
		const recipe = await this.getRecipe(id, shelterCode);
		if (!recipe) return false;

		if (recipe.override) {
			const repo = this.getWriteRepo(recipe.shelter_code);
			await repo.remove(recipe);
			return true;
		}

		const shelterDb = shelterCode ? `shelter_${shelterCode.toLowerCase()}` : getShelterDb();
		const shelterRepo = createRemoteRepository(shelterDb);
		const mealPlans = await shelterRepo.allByType(
			'meal_plan',
			(d): d is { _id: string; type: string; recipes: { recipe_id: string }[] } => {
				return !!d && typeof d === 'object' && (d as { type?: unknown }).type === 'meal_plan';
			}
		);
		const isUsed = mealPlans.some((plan) => plan.recipes?.some((r) => r.recipe_id === id));

		if (isUsed) {
			recipe.deactivated = true;
			await this.updateRecipe(recipe);
			return false;
		} else {
			const repo = this.getWriteRepo(recipe.shelter_code);
			await repo.remove(recipe);
			return true;
		}
	}
}

let singleton: CatalogRepository | null = null;

export function catalogRepository(): CatalogRepository {
	if (!singleton) singleton = new CatalogRemoteRepository();
	return singleton;
}
