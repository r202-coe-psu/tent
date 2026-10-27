// Compare exact decimal strings without coercing stock quantities to numbers.
export function isNonPositiveStockQuantity(quantity: string): boolean {
	const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(quantity.trim());
	return Boolean(match && (match[1] === '-' || !/[1-9]/.test(match[2] + (match[3] ?? ''))));
}

// Avoid numeric coercion so large quantities and decimal precision remain exact.
export function formatStockQuantity(quantity: string): string {
	const match = /^(-?)(\d+)(\.\d+)?$/.exec(quantity.trim());
	if (!match) return quantity;
	const [, sign, integer, fraction = ''] = match;
	return `${sign}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction}`;
}
