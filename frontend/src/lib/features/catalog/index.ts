/**
 * Public API of the `catalog` feature.
 * Cross-feature and route code imports ONLY from here.
 */

// Domain — documents
export type {
	Recipe,
	Ingredient,
	ItemCategory,
	ItemMaster,
	SystemCategoryKey,
	SystemItemCategoryDef
} from './domain/catalog';
export type {
	Dimension,
	UnitOfMeasure,
	UnitOfMeasureInput,
	UnitOfMeasureUpdateInput,
	FallbackUnitDef
} from './domain/unit-of-measure';

// Domain — deletion policy & utilities
export {
	type CatalogDeletionAction,
	type ShelterCategoryUsage,
	type CategoryUsageDetails,
	type CatalogDeletionDecision,
	type DeleteCategoryResult,
	evaluateCategoryDeletion
} from './domain/catalog-deletion';

// Domain — input schemas + factories + transitions + guards
export {
	// System categories (CR-119)
	SYSTEM_CATEGORY_KEYS,
	SYSTEM_ITEM_CATEGORIES,
	systemCategoryId,
	resolveCategoryId,
	itemBelongsToCategory,
	catalogOrigin,
	canShelterDeleteCatalogDoc,
	// Item Category
	itemCategoryInputSchema,
	type ItemCategoryInput,
	createItemCategory,
	isItemCategory,
	// Item Master
	itemMasterInputSchema,
	type ItemMasterInput,
	itemMasterUpdateInputSchema,
	type ItemMasterUpdateInput,
	createItemMaster,
	isItemMaster,
	itemMasterUnit,
	DEFAULT_ITEM_UNIT,
	mergeCatalogGenerations,
	type CatalogEntry,
	// Recipe
	recipeInputSchema,
	type RecipeInput,
	createRecipe,
	isRecipe
} from './domain/catalog';

export {
	// Unit of Measure
	dimensionSchema,
	unitCodeSchema,
	isCanonicalUnitCode,
	isLegacyUnitLabel,
	assertKnownUnitCodes,
	unitOfMeasureInputSchema,
	unitOfMeasureUpdateSchema,
	createUnitOfMeasure,
	isUnitOfMeasure,
	FALLBACK_UNIT_DEFINITIONS,
	FALLBACK_UNIT_LABELS,
	formatUnit
} from './domain/unit-of-measure';

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
	useInspectCategoryUsage,
	useDeleteItemCategory,
	// Item Master
	useItemMasters,
	useItemMastersPaginated,
	useCreateItemMaster,
	useUpdateItemMaster,
	useDeleteItemMaster,
	// Recipes
	useRecipes,
	useRecipesPaginated,
	useRecipe,
	useCreateRecipe,
	useUpdateRecipe,
	useDeleteRecipe,
	// Units of Measure
	useUnitsOfMeasure,
	useUnitsOfMeasurePaginated,
	useUnitOfMeasure,
	useCreateUnitOfMeasure,
	useUpdateUnitOfMeasure,
	useDeleteUnitOfMeasure
} from './application/queries';

// UI — feature components
export { default as CatalogFormPage } from './ui/catalog-form-page.svelte';
export { default as CatalogWorkspace } from './ui/catalog-workspace.svelte';
export { default as ProductsPanel } from './ui/products-panel.svelte';
export { default as ItemCategoryForm } from './ui/item-category-form.svelte';
export { default as ItemMasterForm } from './ui/item-master-form.svelte';
export { default as RecipeForm } from './ui/recipe-form.svelte';
