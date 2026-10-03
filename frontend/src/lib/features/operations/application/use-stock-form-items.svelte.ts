import { useItemMasters } from '$lib/features/catalog';
import { useSupplyItems } from '$lib/features/supply';
import { toStockFormItems, type StockFormItem } from '../domain/stock-form-items';

/**
 * Shared catalog for stock movement forms: legacy supply items + active item
 * masters, mapped to {@link StockFormItem} (packaging + optional sku).
 */
export function useStockFormItems(shelterCode: () => string) {
	const itemsQuery = useSupplyItems();
	const itemMastersQuery = useItemMasters(shelterCode);
	const items = $derived<StockFormItem[]>(
		toStockFormItems(itemsQuery.data ?? [], itemMastersQuery.data ?? [])
	);
	return {
		get items() {
			return items;
		},
		get isLoading() {
			return itemsQuery.isLoading || itemMastersQuery.isLoading;
		}
	};
}
