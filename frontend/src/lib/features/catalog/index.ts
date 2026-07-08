/**
 * Public API of the `catalog` feature.
 * Cross-feature and route code imports ONLY from here.
 */

// Domain — documents
export type { Recipe, Ingredient, ItemCategory, ItemMaster } from './domain/catalog';

// Domain — input schemas + factories + transitions + guards
export {
	// Item Category
	itemCategoryInputSchema,
	type ItemCategoryInput,
	createItemCategory,
	isItemCategory,
	// Item Master
	itemMasterInputSchema,
	type ItemMasterInput,
	createItemMaster,
	isItemMaster,
	// Recipe
	recipeInputSchema,
	type RecipeInput,
	createRecipe,
	isRecipe
} from './domain/catalog';

// Data — repository contract + remote CouchDB binding
export type { CatalogRepository } from './data/catalog.repository';
export { catalogRepository, CATALOG_DB } from './data/catalog.remote';

// Application — TanStack Query hooks + changes-feed wiring
export {
	catalogKeys,
	startCatalogMasterLiveQuery,
	// Item Category
	useItemCategories,
	useItemCategoriesPaginated,
	useItemCategory,
	useCreateItemCategory,
	useUpdateItemCategory,
	// Item Master
	useItemMasters,
	useItemMastersPaginated,
	useCreateItemMaster,
	useUpdateItemMaster,
	// Recipes
	useRecipes,
	useRecipesPaginated,
	useRecipe,
	useCreateRecipe,
	useUpdateRecipe
} from './application/queries';

// UI — feature components
export { default as CatalogFormPage } from './ui/catalog-form-page.svelte';
export { default as ItemCategoryForm } from './ui/item-category-form.svelte';
export { default as ItemMasterForm } from './ui/item-master-form.svelte';
export { default as RecipeForm } from './ui/recipe-form.svelte';
