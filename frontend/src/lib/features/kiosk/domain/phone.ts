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
