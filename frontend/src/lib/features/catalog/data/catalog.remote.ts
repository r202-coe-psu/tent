import { paginateItems } from '$lib/db/paginate';
import { createRemoteRepository, type Repository, type PaginatedResult } from '$lib/db/repository';
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
import {
	createUnitOfMeasure,
	isUnitOfMeasure,
	assertKnownUnitCodes,
	isCanonicalUnitCode,
	isLegacyUnitLabel,
	type UnitOfMeasure,
	type UnitOfMeasureInput
} from '../domain/unit-of-measure';
import {
	evaluateCategoryDeletion,
	type CategoryUsageDetails,
	type DeleteCategoryResult
} from '../domain/catalog-deletion';
import { NotFoundError, CouchAuthError, AuthError } from '$lib/utils/errors';
import type { CatalogRepository } from './catalog.repository';

export const CATALOG_DB = 'catalog';

type AnyDoc = { _id: string; type: string; [key: string]: unknown };

function isDocType(type: string) {
	return (doc: unknown): doc is AnyDoc =>
		!!doc && typeof doc === 'object' && (doc as { type?: unknown }).type === type;
}

function unitReferencesDoc(doc: AnyDoc, code: string): boolean {
	const target = code.trim().toLowerCase();
	const same = (value: unknown) =>
		typeof value === 'string' && value.trim().toLowerCase() === target;

	if (doc.type === 'item_master') {
		const conversions = Array.isArray(doc.conversions) ? doc.conversions : [];
		return [
			doc.base_unit,
			doc.default_inventory_uom,
			doc.default_issue_uom,
			...conversions.map((conversion) =>
				conversion && typeof conversion === 'object'
					? (conversion as { uom_name?: unknown }).uom_name
					: undefined
			)
		].some(same);
	}
	if (doc.type === 'recipe') {
		return (Array.isArray(doc.ingredients) ? doc.ingredients : []).some(
			(ingredient) =>
				!!ingredient &&
				typeof ingredient === 'object' &&
				same((ingredient as { uom?: unknown }).uom)
		);
	}
	if (doc.type === 'donation_campaign') {
		return (Array.isArray(doc.needs) ? doc.needs : []).some(
			(need) => !!need && typeof need === 'object' && same((need as { unit?: unknown }).unit)
		);
	}
	if (doc.type === 'stock_ledger') {
		return same(doc.unit);
	}
	if (doc.type === 'purchase') {
		return (Array.isArray(doc.items) ? doc.items : []).some(
			(item) => !!item && typeof item === 'object' && same((item as { unit?: unknown }).unit)
		);
	}
	if (doc.type === 'stock_transfer') {
		return (Array.isArray(doc.items) ? doc.items : []).some(
			(item) => !!item && typeof item === 'object' && same((item as { unit?: unknown }).unit)
		);
	}
	return false;
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

	async createItemCategory(
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
		return paginateItems(items, page, pageSize);
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

	async createItemMaster(
		input: ItemMasterInput,
		ctx: AuthorContext,
		shelterCode?: string
	): Promise<ItemMaster> {
		const repo = this.getWriteRepo(shelterCode);
		const item = createItemMaster(input, ctx, shelterCode);
		await this.validateItemMasterUnits(item);
		return repo.put(item);
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
		return paginateItems(items, page, pageSize);
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
		const current = await this.getItemMaster(itemMaster._id, itemMaster.shelter_code);
		if (!current) throw new Error(`Item master not found: ${itemMaster._id}`);
		await this.validateItemMasterUnits(itemMaster, current);
		const repo = this.getWriteRepo(itemMaster.shelter_code);
		return repo.put(touch(itemMaster));
	}

	private async validateItemMasterUnits(item: ItemMaster, current?: ItemMaster): Promise<void> {
		const units = await this.listUnitsOfMeasure();
		if (units.length === 0) {
			throw new Error('Unit of measure master is unavailable; item master write was rejected');
		}

		const legacyBaseUnchanged =
			!!current &&
			typeof current.base_unit === 'string' &&
			current.base_unit === item.base_unit &&
			!isCanonicalUnitCode(item.base_unit) &&
			isLegacyUnitLabel(item.base_unit);
		if (!legacyBaseUnchanged && !isCanonicalUnitCode(item.base_unit)) {
			throw new Error(`Base unit must be a valid lowercase English code: ${item.base_unit}`);
		}
		const canonicalCodes = [
			item.default_inventory_uom,
			item.default_issue_uom,
			...(item.conversions ?? []).map((conversion) => conversion.uom_name),
			...(legacyBaseUnchanged ? [] : [item.base_unit])
		].filter((code): code is string => !!code && code.trim() !== '');

		assertKnownUnitCodes(canonicalCodes, units, {
			allowDeactivated: current?.base_unit === item.base_unit ? [item.base_unit] : []
		});
	}

	async createRecipe(
		input: RecipeInput,
		ctx: AuthorContext,
		shelterCode?: string
	): Promise<Recipe> {
		const repo = this.getWriteRepo(shelterCode);
		const recipe = createRecipe(input, ctx, shelterCode);
		await this.validateRecipeUnits(recipe);
		return repo.put(recipe);
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
		return paginateItems(items, page, pageSize);
	}

	async getRecipe(id: string, shelterCode?: string | null): Promise<Recipe | null> {
		if (shelterCode) {
			const localRepo = createRemoteRepository(`shelter_${shelterCode.toLowerCase()}`);
			const localDoc = await localRepo.get<Recipe>(id);
			if (localDoc) return localDoc;
		}
		return this.repo.get<Recipe>(id);
	}

	async updateRecipe(recipe: Recipe): Promise<Recipe> {
		const repo = this.getWriteRepo(recipe.shelter_code);
		await this.validateRecipeUnits(recipe);
		return repo.put(touch(recipe));
	}

	private async validateRecipeUnits(recipe: Recipe): Promise<void> {
		const units = await this.listUnitsOfMeasure();
		if (units.length === 0) {
			throw new Error('Unit of measure master is unavailable; recipe write was rejected');
		}
		assertKnownUnitCodes(
			recipe.ingredients.map((ingredient) => ingredient.uom),
			units
		);
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

	async createUnitOfMeasure(input: UnitOfMeasureInput, ctx: AuthorContext): Promise<UnitOfMeasure> {
		const doc = createUnitOfMeasure(input, ctx);
		if (await this.getUnitOfMeasure(doc.code)) {
			throw new Error(`รหัสหน่วยนับนี้มีอยู่ในระบบแล้ว: ${doc.code}`);
		}
		return this.repo.put(doc);
	}

	async listUnitsOfMeasure(): Promise<UnitOfMeasure[]> {
		const items = await this.repo.allByType('unit_of_measure', isUnitOfMeasure);
		return items.sort((a, b) => {
			if (typeof a.sort_order === 'number' && typeof b.sort_order === 'number') {
				return a.sort_order - b.sort_order;
			}
			if (typeof a.sort_order === 'number') return -1;
			if (typeof b.sort_order === 'number') return 1;
			return a.label_th.localeCompare(b.label_th, 'th');
		});
	}

	async listUnitsOfMeasurePaginated(
		page: number,
		pageSize: number
	): Promise<PaginatedResult<UnitOfMeasure>> {
		const items = await this.listUnitsOfMeasure();
		return paginateItems(items, page, pageSize);
	}

	async getUnitOfMeasure(codeOrId: string): Promise<UnitOfMeasure | null> {
		const id = codeOrId.startsWith('unit_of_measure:') ? codeOrId : `unit_of_measure:${codeOrId}`;
		return this.repo.get<UnitOfMeasure>(id);
	}

	async updateUnitOfMeasure(uom: UnitOfMeasure): Promise<UnitOfMeasure> {
		const existing = await this.getUnitOfMeasure(uom._id);
		if (!existing) {
			throw new Error(`ไม่พบข้อมูลหน่วยนับ: ${uom._id}`);
		}
		if (existing.code !== uom.code) {
			throw new Error('ไม่สามารถเปลี่ยนรหัสหน่วยนับได้');
		}
		if (existing.is_protected) {
			if (!uom.is_protected) {
				throw new Error('ไม่สามารถยกเลิกการปกป้องหน่วยนับมาตรฐานของระบบได้');
			}
			if (existing.dimension !== uom.dimension) {
				throw new Error('ไม่สามารถแก้ไขรหัสหรือมิติการวัดของหน่วยนับมาตรฐานได้');
			}
		}

		// Merge only editable fields onto the latest persisted document so a stale
		// form cannot overwrite newer labels or send an obsolete _rev to CouchDB.
		const updated: UnitOfMeasure = {
			...existing,
			label_th: uom.label_th,
			label_th_short: uom.label_th_short,
			label_en: uom.label_en,
			sort_order: uom.sort_order,
			deactivated: uom.deactivated
		};
		return this.repo.put(touch(updated));
	}

	async deleteUnitOfMeasure(id: string): Promise<boolean> {
		const uom = await this.getUnitOfMeasure(id);
		if (!uom) return false;
		if (uom.is_protected) {
			throw new Error('ไม่สามารถลบหน่วยนับมาตรฐานของระบบได้');
		}

		const databases = new Set<string>([CATALOG_DB]);
		try {
			const registry = createRemoteRepository('registry');
			const shelters = await registry.allByType(
				'shelter',
				(doc): doc is AnyDoc =>
					!!doc &&
					typeof doc === 'object' &&
					(doc as { type?: unknown }).type === 'shelter' &&
					typeof (doc as { code?: unknown }).code === 'string'
			);
			for (const shelter of shelters) {
				databases.add(`shelter_${String(shelter.code).toLowerCase()}`);
			}
		} catch (err) {
			// If registry is unreachable or permission denied, continue with central catalog check
			if (!(
				err instanceof NotFoundError ||
				err instanceof CouchAuthError ||
				err instanceof AuthError ||
				(typeof err === 'object' &&
					err !== null &&
					((err as { status?: number }).status === 404 ||
						(err as { status?: number }).status === 403))
			)) {
				throw err;
			}
		}

		const referenceTypes = [
			'item_master',
			'recipe',
			'donation_campaign',
			'stock_ledger',
			'purchase'
		];
		for (const database of databases) {
			const repository = database === CATALOG_DB ? this.repo : createRemoteRepository(database);
			for (const type of referenceTypes) {
				let docs: AnyDoc[];
				try {
					docs = await repository.allByType(type, isDocType(type));
				} catch (err) {
					// If the database does not exist (404) or is forbidden to this session (403), skip it
					if (
						err instanceof NotFoundError ||
						err instanceof CouchAuthError ||
						err instanceof AuthError ||
						(typeof err === 'object' &&
							err !== null &&
							((err as { status?: number }).status === 404 ||
								(err as { status?: number }).status === 403 ||
								(err as { name?: string }).name === 'NotFoundError' ||
								(err as { name?: string }).name === 'CouchAuthError' ||
								(err as { name?: string }).name === 'AuthError'))
					) {
						break;
					}
					throw err;
				}
				const reference = docs.find((doc) => unitReferencesDoc(doc, uom.code));
				if (reference) {
					throw new Error(
						`ไม่สามารถลบหน่วยนับ "${uom.code}" ได้ เนื่องจากมีรายการสินค้าอ้างอิงอยู่ (${reference._id})`
					);
				}
			}
		}
		await this.repo.remove(uom);
		return true;
	}
}

let singleton: CatalogRepository | null = null;

export function catalogRepository(): CatalogRepository {
	if (!singleton) singleton = new CatalogRemoteRepository();
	return singleton;
}
