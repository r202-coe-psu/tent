import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findMasterByCode } from '$lib/server/shelters.admin';
import { fetchDocs } from '$lib/server/donation-docs';
import { adminRaw, serviceError } from '$lib/server/couch-admin';
import { isStockLedger, stockBalance } from '$lib/features/operations/server';
import type { StockLedger } from '$lib/features/operations/server';
import {
	isSupplyItem,
	isStockThresholdOverride,
	calculateReorderLevel
} from '$lib/features/supply/server';
import type { SupplyItem, StockThresholdOverride } from '$lib/features/supply/server';
import { isItemMaster, itemMasterUnit } from '$lib/features/catalog/server';
import type { ItemMaster } from '$lib/features/catalog/server';
import { qtyLte, subQty } from '$lib/utils/qty';

export const prerender = false;

/**
 * GET /api/v1/shelters/{code}/stock-status
 *
 * Public endpoint — returns current stock quantities on hand, reorder thresholds,
 * status, and shortages (gap differences) for all items in the catalog.
 * No personal identifiable info (PII) is exposed here.
 */
export const GET: RequestHandler = async ({ params }) => {
	try {
		const code = params.code;
		if (!code) return json({ message: 'Missing shelter code' }, { status: 400 });

		const master = await findMasterByCode(code);
		if (!master) return json({ message: `Shelter "${code}" not found` }, { status: 404 });

		const db = `shelter_${code.toLowerCase()}`;

		// Query active occupancy count from CouchDB view
		let occupancy = 0;
		try {
			const occupancyRes = await adminRaw(`/${db}/_design/app/_view/occupancy?group=true`, 'GET');
			if (occupancyRes.status === 200) {
				const rows = (occupancyRes.data as { rows?: { key: string; value: number }[] })?.rows ?? [];
				const activeRow = rows.find((r) => r.key === 'active');
				occupancy = activeRow ? activeRow.value : 0;
			}
		} catch (e) {
			console.warn(`Failed to fetch occupancy for shelter ${code}, falling back to 0:`, e);
		}

		// Fetch stock ledger, overrides, and catalog items in parallel
		const [ledgers, overrides, catalogItems, itemMasters] = await Promise.all([
			fetchDocs<StockLedger>(db, 'stock_ledger:'),
			fetchDocs<StockThresholdOverride>(db, 'stock_threshold_override:'),
			fetchDocs<SupplyItem>('catalog', 'item:'),
			fetchDocs<ItemMaster>('catalog', 'item_master:')
		]);

		const validLedgers = ledgers.filter(isStockLedger);
		const validOverrides = overrides.filter(isStockThresholdOverride);
		const validSupplyItems = catalogItems.filter(isSupplyItem);
		const validItemMasters = itemMasters.filter(isItemMaster);

		// Calculate stock balance from ledger
		const balance = stockBalance(validLedgers);

		// Derive last updated timestamp
		let lastUpdated: string | null = null;
		for (const entry of validLedgers) {
			if (entry.occurred_at) {
				if (!lastUpdated || entry.occurred_at > lastUpdated) {
					lastUpdated = entry.occurred_at;
				}
			}
		}

		// Combine both supply items and item masters as the displayed item catalog
		const combinedCatalog = [
			...validSupplyItems.map((si) => ({
				_id: si._id,
				name: si.name,
				category: si.category,
				unit: si.unit,
				reorder_level: si.reorder_level,
				target_reserve_days: si.target_reserve_days,
				consumption_rate: si.consumption_rate,
				timeframe: si.timeframe
			})),
			...validItemMasters.map((im) => ({
				_id: im._id,
				name: im.name,
				category: im.category || 'other',
				unit: itemMasterUnit(im),
				reorder_level: null,
				target_reserve_days: undefined,
				consumption_rate: undefined,
				timeframe: undefined
			}))
		];

		const items = combinedCatalog.map((item) => {
			const qtyOnHand = balance.get(item._id) ?? '0';

			// Find threshold override
			const override = validOverrides.find((o) => o.item_id === item._id);
			let reorderThreshold: string | null = null;

			if (override) {
				if (override.consumption_rate && override.target_reserve_days) {
					reorderThreshold = calculateReorderLevel(occupancy, {
						consumption_rate: override.consumption_rate,
						target_reserve_days: override.target_reserve_days,
						timeframe: item.timeframe || 'daily'
					});
				} else if (override.reorder_level !== null) {
					reorderThreshold = String(override.reorder_level);
				}
			}

			// Fallback to default catalog calculation
			if (reorderThreshold === null) {
				reorderThreshold = calculateReorderLevel(occupancy, item);
			}

			if (reorderThreshold === null && item.reorder_level !== null) {
				reorderThreshold = String(item.reorder_level);
			}

			// Determine status and difference (qty - threshold)
			let status: 'normal' | 'low' | 'empty' = 'normal';
			let difference: string | null = null;

			if (qtyLte(qtyOnHand, 0)) {
				status = 'empty';
			} else if (reorderThreshold !== null && qtyLte(qtyOnHand, reorderThreshold)) {
				status = 'low';
			}

			if (reorderThreshold !== null) {
				difference = subQty(qtyOnHand, reorderThreshold);
			}

			return {
				item_id: item._id,
				name: item.name,
				category: item.category,
				unit: item.unit,
				qty_on_hand: qtyOnHand,
				reorder_threshold: reorderThreshold,
				difference,
				status
			};
		});

		return json({
			shelter_code: code,
			occupancy,
			last_updated: lastUpdated,
			items
		});
	} catch (e) {
		return serviceError(e);
	}
};
