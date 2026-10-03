/**
 * Thai national ID checksum (mod-11). Shared by registration (CR-148) and the volunteer portal.
 * Accepts separators (spaces / dashes) — only the 13 digits are checked.
 */
export function isValidThaiNationalId(value: string): boolean {
	const digits = value.replace(/\D/g, '');
	if (digits.length !== 13) return false;
	let sum = 0;
	for (let i = 0; i < 12; i++) {
		sum += Number(digits[i]) * (13 - i);
	}
	return (11 - (sum % 11)) % 10 === Number(digits[12]);
}
