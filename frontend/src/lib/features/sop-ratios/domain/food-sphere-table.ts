import type { FoodSphereStandard } from './food-sphere';
import type { RequirementGroup } from './requirement-group';
import type { ReplenishmentPolicy } from './replenishment-policy';
import {
	calculateItemDailyDemand,
	calculateReplenishmentAnalysis,
	type DocAlertStatus
} from './replenishment-calc';
import { calculateTotalDailyDemand, type HeadcountBySegment } from './food-sphere-calc';

export interface FoodSphereTableItem {
	itemId: string;
	name: string;
	sku?: string;
	category: string;
	baseUom: string;
	conversionFactor: number;
	sharePercent: number;
	groupDailyDemand: number;
	itemDailyDemand: number;
	physicalStock: number;
	usableStock: number;
	docDays: number | null;
	status: DocAlertStatus;
	shortageQty: number;
	reorderLevel: number;
	standardReorderDays: number;
	reqGroupId: string;
	groupName: string;
	policy: ReplenishmentPolicy | null;
	expiryDate?: string;
	storageNote?: string;
}

export interface FoodSphereTableGroup {
	id: string; // clean req_group_id or 'GENERAL'
	name: string;
	standardUom: string;
	totalGroupDemand: number;
	items: FoodSphereTableItem[];
}

export interface FoodSphereSummaryStats {
	totalItems: number;
	criticalCount: number;
	warningCount: number;
	adequateCount: number;
	overstockCount: number;
	unconfiguredCount: number;
}

/**
 * Resolve effective replenishment policy for an item.
 * Priority: ITEM > REQUIREMENT_GROUP > GLOBAL
 */
export function resolveItemPolicy(
	itemId: string,
	reqGroupId: string,
	policies: ReplenishmentPolicy[]
): ReplenishmentPolicy | null {
	const activePolicies = policies.filter((p) => (p.status ?? 'active') === 'active');
	const cleanItemId = itemId.replace(/^item_master:/, '');
	const cleanGroupId = reqGroupId.replace(/^requirement_group:/, '');

	// 1. Policy for specific item
	const itemPolicy = activePolicies.find(
		(p) => p.scope_type === 'ITEM' && (p.target_id === itemId || p.target_id === cleanItemId)
	);
	if (itemPolicy) return itemPolicy;

	// 2. Policy for requirement group
	if (cleanGroupId && cleanGroupId !== 'GENERAL') {
		const groupPolicy = activePolicies.find(
			(p) =>
				p.scope_type === 'REQUIREMENT_GROUP' &&
				(p.target_id === reqGroupId || p.target_id === cleanGroupId)
		);
		if (groupPolicy) return groupPolicy;
	}

	// 3. Global policy
	const globalPolicy = activePolicies.find((p) => p.scope_type === 'GLOBAL');
	return globalPolicy ?? null;
}

export interface BuildFoodSphereTableOptions {
	itemMasters: Array<{
		_id: string;
		name: string;
		category?: string;
		sku?: string;
		base_unit?: string;
		unit?: string;
	}>;
	balance: Map<string, string>;
	requirementGroups: RequirementGroup[];
	standards: FoodSphereStandard[];
	policies: ReplenishmentPolicy[];
	headcounts: Partial<HeadcountBySegment>;
	latestLotInfo?: Record<string, { expiry?: string; note?: string }>;
}

/**
 * Build grouped food sphere table items and calculate DoC analysis.
 */
export function buildFoodSphereTable(options: BuildFoodSphereTableOptions): {
	groups: FoodSphereTableGroup[];
	summary: FoodSphereSummaryStats;
} {
	const {
		itemMasters,
		balance,
		requirementGroups,
		standards,
		policies,
		headcounts,
		latestLotInfo = {}
	} = options;

	const itemMasterMap = new Map(itemMasters.map((im) => [im._id, im]));
	// Also map by clean id
	for (const im of itemMasters) {
		const clean = im._id.replace(/^item_master:/, '');
		if (!itemMasterMap.has(clean)) {
			itemMasterMap.set(clean, im);
		}
	}

	const processedItemIds = new Set<string>();
	const groups: FoodSphereTableGroup[] = [];

	let totalItems = 0;
	let criticalCount = 0;
	let warningCount = 0;
	let adequateCount = 0;
	let overstockCount = 0;
	let unconfiguredCount = 0;

	function tallyStatus(status: DocAlertStatus) {
		totalItems += 1;
		switch (status) {
			case 'CRITICAL':
				criticalCount += 1;
				break;
			case 'WARNING_REORDER':
				warningCount += 1;
				break;
			case 'ADEQUATE':
				adequateCount += 1;
				break;
			case 'OVERSTOCK':
				overstockCount += 1;
				break;
			case 'UNCONFIGURED':
				unconfiguredCount += 1;
				break;
		}
	}

	// 1. Process configured RequirementGroups
	for (const rg of requirementGroups) {
		if ((rg.status ?? 'active') === 'inactive') continue;
		const cleanGroupId = rg._id.replace(/^requirement_group:/, '');
		const totalGroupDemand = calculateTotalDailyDemand(cleanGroupId, headcounts, standards);
		const groupItems: FoodSphereTableItem[] = [];

		if (rg.item_maps && rg.item_maps.length > 0) {
			for (const map of rg.item_maps) {
				const master = itemMasterMap.get(map.item_id);
				const cleanId = map.item_id.replace(/^item_master:/, '');
				processedItemIds.add(map.item_id);
				processedItemIds.add(cleanId);
				if (master) {
					processedItemIds.add(master._id);
				}

				const sharePercent = map.share_percent ?? 100;
				const conversionFactor = map.conversion_factor > 0 ? map.conversion_factor : 1;
				const itemDailyDemand = calculateItemDailyDemand(
					totalGroupDemand,
					sharePercent,
					conversionFactor
				);

				const rawStock =
					balance.get(map.item_id) ?? (master ? balance.get(master._id) : '0') ?? '0';
				const stockNum = Math.max(0, parseFloat(rawStock) || 0);

				const policy = resolveItemPolicy(map.item_id, cleanGroupId, policies);
				const analysis = calculateReplenishmentAnalysis(stockNum, itemDailyDemand, policy);

				tallyStatus(analysis.status);

				const lot = latestLotInfo[map.item_id] ?? (master ? latestLotInfo[master._id] : undefined);

				groupItems.push({
					itemId: map.item_id,
					name: master?.name ?? map.item_id,
					sku: master?.sku,
					category: master?.category ?? 'food',
					baseUom: map.base_uom || master?.base_unit || master?.unit || 'ชิ้น',
					conversionFactor,
					sharePercent,
					groupDailyDemand: totalGroupDemand,
					itemDailyDemand: analysis.itemDailyDemand,
					physicalStock: stockNum,
					usableStock: stockNum,
					docDays: analysis.docDays,
					status: analysis.status,
					shortageQty: analysis.shortageQty,
					reorderLevel: analysis.reorderLevel,
					standardReorderDays: analysis.standardReorderDays,
					reqGroupId: cleanGroupId,
					groupName: rg.name,
					policy,
					expiryDate: lot?.expiry,
					storageNote: lot?.note
				});
			}
		}

		groups.push({
			id: cleanGroupId,
			name: rg.name,
			standardUom: rg.standard_uom,
			totalGroupDemand,
			items: groupItems
		});
	}

	// 2. Process unmapped items into "รายการทั่วไป (General Items)" group
	const unmappedItems: FoodSphereTableItem[] = [];
	for (const im of itemMasters) {
		if (processedItemIds.has(im._id)) continue;
		const cleanId = im._id.replace(/^item_master:/, '');
		if (processedItemIds.has(cleanId)) continue;

		const rawStock = balance.get(im._id) ?? '0';
		const stockNum = Math.max(0, parseFloat(rawStock) || 0);

		const policy = resolveItemPolicy(im._id, 'GENERAL', policies);
		const analysis = calculateReplenishmentAnalysis(stockNum, 0, policy);

		tallyStatus(analysis.status);

		const lot = latestLotInfo[im._id];

		unmappedItems.push({
			itemId: im._id,
			name: im.name,
			sku: im.sku,
			category: im.category ?? 'other',
			baseUom: im.base_unit || im.unit || 'ชิ้น',
			conversionFactor: 1,
			sharePercent: 100,
			groupDailyDemand: 0,
			itemDailyDemand: 0,
			physicalStock: stockNum,
			usableStock: stockNum,
			docDays: analysis.docDays,
			status: analysis.status,
			shortageQty: analysis.shortageQty,
			reorderLevel: analysis.reorderLevel,
			standardReorderDays: analysis.standardReorderDays,
			reqGroupId: 'GENERAL',
			groupName: 'รายการทั่วไป',
			policy,
			expiryDate: lot?.expiry,
			storageNote: lot?.note
		});
	}

	if (unmappedItems.length > 0) {
		groups.push({
			id: 'GENERAL',
			name: 'รายการทั่วไป',
			standardUom: 'ชิ้น',
			totalGroupDemand: 0,
			items: unmappedItems
		});
	}

	return {
		groups,
		summary: {
			totalItems,
			criticalCount,
			warningCount,
			adequateCount,
			overstockCount,
			unconfiguredCount
		}
	};
}
