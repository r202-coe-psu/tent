const CANONICAL = /^0\d{8,9}$/;

/** Canonical Thai phone: digits only, leading 0, 9–10 digits (landline or mobile). */
export function normalizeKioskPhone(raw: string): string | null {
	const digits = raw.replace(/\D/g, '');
	const local = /^66\d{8,9}$/.test(digits) ? `0${digits.slice(2)}` : digits;
	return CANONICAL.test(local) ? local : null;
}

/** Stored-value variants still present in legacy documents. */
export function phoneVariants(canonical: string): string[] {
	return [canonical, `+66${canonical.slice(1)}`];
}

export function phoneSuffixForLog(canonical: string): string {
	return `••••••${canonical.slice(-4)}`;
}

export function formatPhoneForDisplay(digits: string): string {
	if (/^0\d{9}$/.test(digits)) {
		return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
	}
	if (/^0\d{8}$/.test(digits)) {
		return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
	}
	return digits;
}

/** A phone the kiosk can search with: canonical and written the local way (leading 0). */
export function isKioskPhoneSubmittable(phone: string): boolean {
	return normalizeKioskPhone(phone) !== null && phone.startsWith('0');
}

/**
 * Why the search button is still disabled — null when nothing is typed yet or the number is
 * ready, so the kiosk only nags after the visitor has started entering digits.
 */
export function phoneEntryHint(phone: string): string | null {
	if (phone.length === 0 || isKioskPhoneSubmittable(phone)) return null;
	return 'กรอกให้ครบ 9–10 หลัก ขึ้นต้นด้วย 0';
}
