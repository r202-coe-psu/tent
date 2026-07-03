import type { AuthorContext } from '$lib/db/model';
import type { PaginatedResult } from '$lib/db/repository';
import type {
	ItemCategory,
	ItemCategoryInput,
	ItemMaster,
	ItemMasterInput,
	Recipe,
	RecipeInput
} from '../domain/catalog';

export interface CatalogRepository {
	// Item Category
	createItemCategory(input: ItemCategoryInput, ctx: AuthorContext): Promise<ItemCategory>;

	listItemCategories(): Promise<ItemCategory[]>;

	listItemCategoriesPaginated(
		page: number,
		pageSize: number
	): Promise<PaginatedResult<ItemCategory>>;

	getItemCategory(id: string): Promise<ItemCategory | null>;

	updateItemCategory(itemCategory: ItemCategory): Promise<ItemCategory>;

	// Item Master
	createItemMaster(input: ItemMasterInput, ctx: AuthorContext): Promise<ItemMaster>;

	listItemMasters(): Promise<ItemMaster[]>;

	listItemMastersPaginated(page: number, pageSize: number): Promise<PaginatedResult<ItemMaster>>;

	getItemMaster(id: string): Promise<ItemMaster | null>;

	updateItemMaster(itemMaster: ItemMaster): Promise<ItemMaster>;

	// Recipe
	createRecipe(input: RecipeInput, ctx: AuthorContext): Promise<Recipe>;

	listRecipes(): Promise<Recipe[]>;

	listRecipesPaginated(page: number, pageSize: number): Promise<PaginatedResult<Recipe>>;

	getRecipe(id: string): Promise<Recipe | null>;

	updateRecipe(recipe: Recipe): Promise<Recipe>;
}
