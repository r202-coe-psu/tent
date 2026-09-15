import { createRemoteRepository, type Repository, type PaginatedResult } from '$lib/db/repository';
import { touch, now, type AuthorContext } from '$lib/db/model';
import {
	createItemCategory,
	isItemCategory,
	type ItemCategory,
	type ItemCategoryInput,
	createItemMaster,
	type ItemMaster,
	type ItemMasterInput,
	itemMasterInputSchema,
	normalizeItemMasterFields,
	isItemMaster,
	createRecipe,
	type Recipe,
	type RecipeInput,
	isRecipe,
	isSystemCategoryDocId,
	categoryReferenceMatches,
	SYSTEM_CATEGORY_DEFINITIONS
} from '../domain/catalog';
import {
	evaluateCategoryDeletion,
	type CategoryUsageDetails,
	type DeleteCategoryResult
} from '../domain/catalog-deletion';
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

	async updateItemCategory(itemCategory: ItemCategory): Promise<ItemCategory> {
		if (itemCategory.is_protected || isSystemCategoryDocId(itemCategory._id)) {
			if (itemCategory.override || itemCategory.shelter_code) {
				throw new Error('ไม่อนุญาตให้สร้าง local override บนหมวดหมู่ระบบมาตรฐาน');
			}
			const existing = await this.repo.get<ItemCategory>(itemCategory._id);
			if (existing) {
				itemCategory.system_key = existing.system_key;
				itemCategory.default_class = existing.default_class;
				itemCategory.is_protected = true;
			}
		}
		const repo = this.getWriteRepo(itemCategory.shelter_code);
		return repo.put(touch(itemCategory));
	}

	private async canonicalizeItemMasterCategory(
		category?: string,
		shelterCode?: string | null
	): Promise<string | undefined> {
		if (!category) return undefined;
		if (isSystemCategoryDocId(category)) return category;

		const categories = await this.listItemCategories(shelterCode);
		const matched = categories.filter((cat) => categoryReferenceMatches(category, cat));

		if (matched.length > 1) {
			throw new Error(`หมวดหมู่ '${category}' มีข้อมูลซ้ำซ้อน ไม่สามารถระบุหมวดหมู่ที่แน่นอนได้`);
		}
		if (matched.length === 1) {
			return matched[0]._id;
		}

		const systemMatches = SYSTEM_CATEGORY_DEFINITIONS.filter(
			(def) =>
				def.id === category ||
				def.name === category ||
				def.key.toUpperCase() === category.toUpperCase() ||
				def.id === `item_category:${category.toLowerCase()}`
		);
		if (systemMatches.length > 1) {
			throw new Error(`หมวดหมู่ '${category}' มีข้อมูลซ้ำซ้อน ไม่สามารถระบุหมวดหมู่ที่แน่นอนได้`);
		}
		if (systemMatches.length === 1) {
			return systemMatches[0].id;
		}

		if (category.startsWith('item_category:')) {
			return category;
		}

		throw new Error(`ไม่พบหมวดหมู่ '${category}' ในระบบ`);
	}

	async createItemMaster(
		input: ItemMasterInput,
		ctx: AuthorContext,
		shelterCode?: string
	): Promise<ItemMaster> {
		const canonicalCategory = await this.canonicalizeItemMasterCategory(
			input.category,
			shelterCode
		);
		const normalizedInput = { ...input, category: canonicalCategory };
		const repo = this.getWriteRepo(shelterCode);
		return repo.put(createItemMaster(normalizedInput, ctx, shelterCode));
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

	async updateItemMaster(itemMaster: ItemMaster): Promise<ItemMaster> {
		const canonicalCategory = await this.canonicalizeItemMasterCategory(
			itemMaster.category,
			itemMaster.shelter_code
		);

		const parsedInput = itemMasterInputSchema.parse({
			...itemMaster,
			category: canonicalCategory
		});

		const normalizedFields = normalizeItemMasterFields(parsedInput, {
			shelterCode: itemMaster.shelter_code,
			override: itemMaster.override
		});

		const docToSave: ItemMaster = {
			_id: itemMaster._id,
			...(itemMaster._rev ? { _rev: itemMaster._rev } : {}),
			type: 'item_master',
			schema_v: itemMaster.schema_v ?? 4,
			created_at: itemMaster.created_at ?? now(),
			created_by: itemMaster.created_by ?? 'system',
			updated_at: now(),
			...normalizedFields,
			category: canonicalCategory
		};
		if (itemMaster.shelter_code) docToSave.shelter_code = itemMaster.shelter_code;
		if (itemMaster.override) docToSave.override = itemMaster.override;

		const repo = this.getWriteRepo(itemMaster.shelter_code);
		return repo.put(docToSave);
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

		// Central scope (System Management) -> Deactivate only to protect cross-shelter history
		if (!shelterCode) {
			item.deactivated = true;
			await this.updateItemMaster(item);
			return false;
		}

		// Shelter scope (custom item created by this shelter)
		const shelterDb = `shelter_${shelterCode.toLowerCase()}`;
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
				.filter(
					(item) =>
						item.category &&
						(item.category === id ||
							item.category === category._id ||
							item.category === categoryName)
				)
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
			.filter(
				(item) =>
					!item.shelter_code &&
					item.category &&
					(item.category === id || item.category === category._id || item.category === categoryName)
			)
			.map((item) => item.name);

		return {
			categoryId: id,
			categoryName,
			isOverride: false,
			shelterCode: null,
			centralItemMasters: centralMatching,
			shelterUsages: [],
			totalItemCount: centralMatching.length,
			totalShelterCount: 0
		};
	}

	async deleteItemCategory(id: string, shelterCode?: string | null): Promise<DeleteCategoryResult> {
		const category = await this.getItemCategory(id, shelterCode);
		if (!category) {
			throw new Error(`ไม่พบข้อมูลหมวดหมู่ ${id}`);
		}

		if (category.is_protected || isSystemCategoryDocId(id) || isSystemCategoryDocId(category._id)) {
			throw new Error('ไม่อนุญาตให้ลบหมวดหมู่ระบบมาตรฐาน');
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

		// Central scope (System Management) -> Deactivate only to protect meal plans across shelters
		if (!shelterCode) {
			recipe.deactivated = true;
			await this.updateRecipe(recipe);
			return false;
		}

		// Shelter scope (custom recipe created by this shelter)
		const shelterDb = `shelter_${shelterCode.toLowerCase()}`;
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
