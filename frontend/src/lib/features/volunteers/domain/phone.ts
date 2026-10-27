/** Canonical Thai phone form (`0XXXXXXXXX`) — apply before hashing or storing a volunteer phone. */
export function normalizePhone(value: string): string {
	const digits = value.replace(/[\s\-()]/g, '');
	if (digits.startsWith('+66')) return `0${digits.slice(3)}`;
	if (digits.startsWith('66') && digits.length >= 11) return `0${digits.slice(2)}`;
	return digits;
}
