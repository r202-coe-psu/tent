import { resolveCategoryId, systemCategoryId } from '$lib/features/catalog';
import type { ItemMaster } from '$lib/features/catalog';

// Built per call: the kitchen barrel is imported widely, so loading it must not call into catalog.
const cookingCategoryIds = () => new Set([systemCategoryId('FOOD'), systemCategoryId('WATER')]);

/** item master ที่เลือกเป็นวัตถุดิบทำอาหารได้: หมวดอาหารหรือน้ำดื่ม (id หรือชื่อเดิม) และยังใช้งานอยู่ */
export function selectableCookingIngredients<
	T extends Pick<ItemMaster, 'category' | 'deactivated' | 'merged_into'>
>(masters: readonly T[] | undefined): T[] {
	const cookingCategories = cookingCategoryIds();
	return (masters ?? []).filter((m) => {
		if (m.deactivated || m.merged_into) return false;
		const category = resolveCategoryId(m.category, []);
		return category !== undefined && cookingCategories.has(category);
	});
}
