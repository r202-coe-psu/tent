import type { ItemCategory, ItemMasterInput, StorageType, TypeClass } from './catalog';
import { mergeBaseBarcode } from './item-barcode';

/** What the quick-create form collects; everything but name + base unit is optional. */
export type QuickCreateDraft = {
	name: string;
	categoryId?: string;
	baseUnit: string;
	/** One packaging row: 1 `packUnit` = `packMultiplier` base units. */
	packUnit?: string;
	packMultiplier?: string;
	/** Receive in the pack unit by default. */
	packAsDefault?: boolean;
	storage?: StorageType;
	/** Scanned or typed barcode of the item itself (stored on the base-unit row). */
	barcode?: string;
};

/** Seed values for the full item form when quick-create hands a draft over. */
export type ItemMasterInitialValues = {
	name?: string;
	category?: string;
	type_class?: TypeClass;
	base_unit?: string;
	/** Packaging rows; a row for the base unit is read as the base-unit barcode. */
	conversions?: { uom_name: string; multiplier: string; barcode?: string }[];
	default_inventory_uom?: string;
	storage_type?: StorageType;
	/** Barcode of the base unit. */
	barcode?: string;
};

export type QuickCreateErrors = Partial<Record<'name' | 'category' | 'baseUnit' | 'pack', string>>;

/** The default stock storage the form pre-selects (mockup: "แห้ง"). */
export const QUICK_CREATE_DEFAULT_STORAGE: StorageType = 'DRY';

/** `type_class` of a quick-created item: its category's default, else consumable. */
export function quickCreateTypeClass(
	categoryId: string | undefined,
	categories: readonly Pick<ItemCategory, '_id' | 'default_class'>[]
): TypeClass {
	return categories.find((c) => c._id === categoryId)?.default_class ?? 'CONSUMABLE';
}

function hasPack(draft: QuickCreateDraft): boolean {
	return !!draft.packUnit?.trim();
}

/** Required fields only — name, category and base unit, plus a sane pack row if one is started. */
export function validateQuickCreate(
	draft: QuickCreateDraft,
	opts: { requireCategory?: boolean } = {}
): QuickCreateErrors {
	const errors: QuickCreateErrors = {};
	if (!draft.name.trim()) errors.name = 'กรุณาระบุชื่อสินค้า';
	if (opts.requireCategory && !draft.categoryId) errors.category = 'กรุณาเลือกหมวด';
	if (!draft.baseUnit.trim()) errors.baseUnit = 'กรุณาเลือกหน่วยนับเล็กสุด';

	if (hasPack(draft)) {
		const multiplier = Number(draft.packMultiplier);
		if (!Number.isFinite(multiplier) || multiplier <= 0) {
			errors.pack = 'จำนวนต่อแพ็คต้องมากกว่า 0';
		} else if (draft.packUnit!.trim() === draft.baseUnit.trim()) {
			errors.pack = 'ขนาดบรรจุต้องเป็นหน่วยอื่นที่ไม่ใช่หน่วยฐาน';
		}
	}
	return errors;
}

/** Map a validated draft onto the standard item-master input (same schema as the full form). */
export function buildQuickCreateInput(
	draft: QuickCreateDraft,
	categories: readonly Pick<ItemCategory, '_id' | 'default_class'>[]
): ItemMasterInput {
	const typeClass = quickCreateTypeClass(draft.categoryId, categories);
	const baseUnit = draft.baseUnit.trim();
	const packUnit = hasPack(draft) ? draft.packUnit!.trim() : '';

	const packRows = packUnit
		? [{ uom_name: packUnit, multiplier: (draft.packMultiplier ?? '1').trim() }]
		: [];

	return {
		name: draft.name.trim(),
		...(draft.categoryId ? { category: draft.categoryId } : {}),
		type_class: typeClass,
		base_unit: baseUnit,
		conversions: mergeBaseBarcode(packRows, baseUnit, draft.barcode ?? ''),
		...(packUnit && draft.packAsDefault ? { default_inventory_uom: packUnit } : {}),
		...(typeClass === 'EQUIPMENT'
			? { asset_status: 'READY' as const }
			: { distribution_type: 'recurring' as const }),
		...(typeClass === 'CONSUMABLE'
			? { storage_type: draft.storage ?? QUICK_CREATE_DEFAULT_STORAGE }
			: {})
	};
}
