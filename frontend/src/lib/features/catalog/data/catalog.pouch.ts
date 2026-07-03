import { namedLocalDb } from '$lib/db/pouch';
import { createRepository, type Repository, type PaginatedResult } from '$lib/db/repository';
import { touch, type AuthorContext } from '$lib/db/model';
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
import type { CatalogRepository } from './catalog.repository';

export const CATALOG_DB = 'catalog';

export class CatalogPouchRepository implements CatalogRepository {
	private readonly repo: Repository;

	constructor(dbName: string = CATALOG_DB) {
		this.repo = createRepository(namedLocalDb(dbName));
	}

	// Item Category
	createItemCategory(input: ItemCategoryInput, ctx: AuthorContext): Promise<ItemCategory> {
		return this.repo.put(createItemCategory(input, ctx));
	}

	listItemCategories(): Promise<ItemCategory[]> {
		return this.repo.allByType('item_category', isItemCategory);
	}

	listItemCategoriesPaginated(
		page: number,
		pageSize: number
	): Promise<PaginatedResult<ItemCategory>> {
		return this.repo.pageByType('item_category', isItemCategory, page, pageSize);
	}

	getItemCategory(id: string): Promise<ItemCategory | null> {
		return this.repo.get<ItemCategory>(id);
	}

	updateItemCategory(itemCategory: ItemCategory): Promise<ItemCategory> {
		return this.repo.put(touch(itemCategory));
	}

	// Item Master
	createItemMaster(input: ItemMasterInput, ctx: AuthorContext): Promise<ItemMaster> {
		return this.repo.put(createItemMaster(input, ctx));
	}

	listItemMasters(): Promise<ItemMaster[]> {
		return this.repo.allByType('item_master', isItemMaster);
	}
	listItemMastersPaginated(page: number, pageSize: number): Promise<PaginatedResult<ItemMaster>> {
		return this.repo.pageByType('item_master', isItemMaster, page, pageSize);
	}
	getItemMaster(id: string): Promise<ItemMaster | null> {
		return this.repo.get<ItemMaster>(id);
	}
	updateItemMaster(itemMaster: ItemMaster): Promise<ItemMaster> {
		return this.repo.put(touch(itemMaster));
	}

	// Recipe
	createRecipe(input: RecipeInput, ctx: AuthorContext): Promise<Recipe> {
		return this.repo.put(createRecipe(input, ctx));
	}
	listRecipes(): Promise<Recipe[]> {
		return this.repo.allByType('recipe', isRecipe);
	}
	listRecipesPaginated(page: number, pageSize: number): Promise<PaginatedResult<Recipe>> {
		return this.repo.pageByType('recipe', isRecipe, page, pageSize);
	}
	getRecipe(id: string): Promise<Recipe | null> {
		return this.repo.get<Recipe>(id);
	}
	updateRecipe(Recipe: Recipe): Promise<Recipe> {
		return this.repo.put(touch(Recipe));
	}
}

let singleton: CatalogRepository | null = null;

export function CatalogRepository(): CatalogRepository {
	if (!singleton) singleton = new CatalogPouchRepository();
	return singleton!;
}

export function shelterDb(): PouchDB.Database {
	return namedLocalDb(CATALOG_DB);
}
