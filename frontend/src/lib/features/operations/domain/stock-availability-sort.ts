import { qtyLte } from '$lib/utils/qty';

/** A missing balance or a balance <= 0 counts as out of stock. */
export function isOutOfStock(balance: string | undefined): boolean {
	if (balance === undefined || balance === '') return true;
	return qtyLte(balance, 0);
}

/** In-stock items first, then out-of-stock; each group sorted by name (Thai collation). */
export function sortInStockFirstByName<T>(
	items: readonly T[],
	getBalance: (item: T) => string | undefined,
	getName: (item: T) => string
): T[] {
	return items
		.map((item, index) => ({ item, index, out: isOutOfStock(getBalance(item)) }))
		.sort((a, b) => {
			if (a.out !== b.out) return a.out ? 1 : -1;
			const byName = getName(a.item).localeCompare(getName(b.item), 'th');
			return byName !== 0 ? byName : a.index - b.index;
		})
		.map((entry) => entry.item);
}

/** Stable partition: in-stock first, out-of-stock last, input order kept inside each group. */
export function partitionInStockFirst<T>(
	items: readonly T[],
	getBalance: (item: T) => string | undefined
): T[] {
	const inStock: T[] = [];
	const outOfStock: T[] = [];
	for (const item of items) {
		(isOutOfStock(getBalance(item)) ? outOfStock : inStock).push(item);
	}
	return [...inStock, ...outOfStock];
}
