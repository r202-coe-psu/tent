/**
 * Domain types and pure policy evaluation for catalog item category deletion.
 * Designed to be reusable across catalog entities (Category, Item Master, Recipe).
 */

export type CatalogDeletionAction = 'hard_delete' | 'deactivate' | 'reset';

export interface ShelterCategoryUsage {
	shelterCode: string;
	shelterName?: string;
	itemMasters: string[];
	hasOverride: boolean;
}

export interface CategoryUsageDetails {
	categoryId: string;
	categoryName: string;
	isOverride: boolean;
	shelterCode?: string | null;
	centralItemMasters: string[];
	shelterUsages: ShelterCategoryUsage[];
	totalItemCount: number;
	totalShelterCount: number;
}

export interface CatalogDeletionDecision {
	action: CatalogDeletionAction;
	reason: string;
	canHardDelete: boolean;
	usage: CategoryUsageDetails;
}

export interface DeleteCategoryResult {
	wasDeleted: boolean;
	actionTaken: CatalogDeletionAction;
	categoryName: string;
}

/**
 * Pure evaluation function for category deletion.
 *
 * Rules:
 * 1. Shelter scope:
 *    - If document is an override (override: true) -> 'reset' (restore central default)
 *    - If local custom document ->
 *        - has item masters using it in this shelter -> 'deactivate'
 *        - no item masters using it -> 'hard_delete'
 * 2. Central scope (System Management):
 *    - If item masters use it (in central or in ANY shelter) OR any shelter has an override -> 'deactivate'
 *    - If completely unused across central and all shelters -> 'hard_delete'
 */
export function evaluateCategoryDeletion(
	usage: CategoryUsageDetails,
	scope: 'central' | 'shelter'
): CatalogDeletionDecision {
	if (scope === 'shelter') {
		if (usage.isOverride) {
			return {
				action: 'reset',
				reason:
					'หมวดหมู่นี้เป็นการปรับแต่งเฉพาะศูนย์ การยืนยันจะลบการปรับแต่งและคืนค่ากลับเป็นค่ามาตรฐานส่วนกลาง',
				canHardDelete: false,
				usage
			};
		}

		if (usage.totalItemCount > 0) {
			return {
				action: 'deactivate',
				reason:
					'หมวดหมู่นี้มีรายการสินค้าในศูนย์พักพิงอ้างอิงอยู่ ระบบจะเปลี่ยนสถานะเป็นปิดการใช้งาน (Deactivated) แทนการลบถาวร',
				canHardDelete: false,
				usage
			};
		}

		return {
			action: 'hard_delete',
			reason: 'ไม่มีรายการสินค้าอ้างอิงถึงหมวดหมู่นี้ สามารถลบออกจากระบบได้อย่างถาวร',
			canHardDelete: true,
			usage
		};
	}

	// Central scope (System Management)
	const hasCentralUsage = usage.centralItemMasters.length > 0;
	const hasShelterUsage = usage.shelterUsages.some((s) => s.itemMasters.length > 0);
	const hasShelterOverride = usage.shelterUsages.some((s) => s.hasOverride);

	if (hasCentralUsage || hasShelterUsage || hasShelterOverride) {
		const reasons: string[] = [];
		if (hasCentralUsage) {
			reasons.push(`มีสินค้าส่วนกลางใช้งานอยู่ ${usage.centralItemMasters.length} รายการ`);
		}
		if (hasShelterUsage) {
			const activeShelters = usage.shelterUsages.filter((s) => s.itemMasters.length > 0);
			reasons.push(`มีศูนย์พักพิงใช้งานอยู่ ${activeShelters.length} ศูนย์`);
		}
		if (hasShelterOverride) {
			const overrideShelters = usage.shelterUsages.filter((s) => s.hasOverride);
			reasons.push(`มีศูนย์พักพิงปรับแต่ง (Override) อยู่ ${overrideShelters.length} ศูนย์`);
		}

		return {
			action: 'deactivate',
			reason: `ไม่สามารถลบถาวรได้เนื่องจาก: ${reasons.join(', ')} ระบบจะเปลี่ยนสถานะเป็นปิดการใช้งาน (Deactivated) แทน`,
			canHardDelete: false,
			usage
		};
	}

	return {
		action: 'hard_delete',
		reason: 'ไม่มีรายการสินค้าหรือศูนย์พักพิงใดใช้งานหมวดหมู่นี้ สามารถลบถาวรออกจากระบบได้',
		canHardDelete: true,
		usage
	};
}
