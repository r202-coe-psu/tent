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
	createItemCategory(
		input: ItemCategoryInput,
		ctx: AuthorContext,
		shelterCode?: string
	): Promise<ItemCategory>;

	listItemCategories(shelterCode?: string | null): Promise<ItemCategory[]>;

	listItemCategoriesPaginated(
		page: number,
		pageSize: number,
		shelterCode?: string | null
	): Promise<PaginatedResult<ItemCategory>>;

	getItemCategory(id: string, shelterCode?: string | null): Promise<ItemCategory | null>;

	updateItemCategory(itemCategory: ItemCategory): Promise<ItemCategory>;

	// Item Master
	createItemMaster(
		input: ItemMasterInput,
		ctx: AuthorContext,
		shelterCode?: string
	): Promise<ItemMaster>;

	listItemMasters(shelterCode?: string | null): Promise<ItemMaster[]>;

	listItemMastersPaginated(
		page: number,
		pageSize: number,
		shelterCode?: string | null
	): Promise<PaginatedResult<ItemMaster>>;

	getItemMaster(id: string, shelterCode?: string | null): Promise<ItemMaster | null>;

	updateItemMaster(itemMaster: ItemMaster): Promise<ItemMaster>;

	// Recipe
	createRecipe(input: RecipeInput, ctx: AuthorContext, shelterCode?: string): Promise<Recipe>;

	listRecipes(shelterCode?: string | null): Promise<Recipe[]>;

	listRecipesPaginated(
		page: number,
		pageSize: number,
		shelterCode?: string | null
	): Promise<PaginatedResult<Recipe>>;

	getRecipe(id: string, shelterCode?: string | null): Promise<Recipe | null>;

	updateRecipe(recipe: Recipe): Promise<Recipe>;

	deleteItemMaster(id: string, shelterCode?: string | null): Promise<boolean>;

	inspectCategoryUsage(
		id: string,
		shelterCode?: string | null
	): Promise<import('../domain/catalog-deletion').CategoryUsageDetails>;

	deleteItemCategory(
		id: string,
		shelterCode?: string | null
	): Promise<import('../domain/catalog-deletion').DeleteCategoryResult>;

	deleteRecipe(id: string, shelterCode?: string | null): Promise<boolean>;
}
