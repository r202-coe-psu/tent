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
export { getItemDisplayName, type NamedItem } from './domain/item-name';

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
	resolveCategoryLabel,
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
	ITEM_MASTER_SCHEMA_V,
	isItemMaster,
	itemMasterUnit,
	DEFAULT_ITEM_UNIT,
	itemSelectableUoms,
	packagingMultiplier,
	qtyToBaseUnit,
	qtyFromBaseUnit,
	defaultInventoryUom,
	defaultIssueUom,
	toLedgerQtyUnit,
	type PackagingUomOption,
	type PackagingSource,
	mergeCatalogGenerations,
	type CatalogEntry,
	// Expiry requirement (CR-143 §D)
	requiresExpiry,
	suggestExpiry,
	shelfLifeExpiryLabel,
	expiryRequirementHint,
	type ExpirySource,
	type StorageType,
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
	canonicalizeUnitCode,
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

// Domain — quick-create, similarity, barcode, permissions
export { findSimilarItems, missingOptionalFields } from './domain/item-similarity';
export {
	normalizeBarcode,
	looksLikeBarcode,
	findItemByBarcode,
	itemBarcodes,
	barcodeOwner,
	isBaseUnitRow,
	splitBaseBarcode,
	mergeBaseBarcode,
	type BarcodeSource,
	type BarcodeMatch
} from './domain/item-barcode';
export {
	QUICK_CREATE_DEFAULT_STORAGE,
	quickCreateTypeClass,
	validateQuickCreate,
	buildQuickCreateInput,
	type QuickCreateDraft,
	type QuickCreateErrors,
	type ItemMasterInitialValues
} from './domain/quick-create';
export { canWriteShelterCatalog } from './domain/catalog-permissions';
export {
	isMergedItem,
	mergedAliasesByTarget,
	isShelterLocalItem,
	canMergeItem,
	resolveItemUnitConversion,
	convertItemQty,
	type ItemUnitConversion
} from './domain/item-merge';

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
export { default as QuickCreateItemDialog } from './ui/quick-create-item-dialog.svelte';
export { default as RecipeForm } from './ui/recipe-form.svelte';
export { default as MasterBadge } from './ui/master/master-badge.svelte';
export { default as MasterFilterBar } from './ui/master/master-filter-bar.svelte';
export { default as MasterPager } from './ui/master/master-pager.svelte';
export { useMasterPaging } from './ui/master/use-master-paging.svelte';
export {
	MASTER_PAGE_SIZE,
	ORIGIN_LABELS,
	ORIGIN_TONES,
	filterUnits,
	hiddenDeactivatedUnits,
	filterRecipes,
	hiddenDeactivatedRecipes,
	ingredientSummary,
	pageSlice,
	isNewItem,
	isIncompleteItem,
	type CatalogOriginKey,
	type MasterBadgeTone,
	type OriginFilter,
	type UnitFilter,
	type RecipeFilter
} from './ui/master/master-view';
