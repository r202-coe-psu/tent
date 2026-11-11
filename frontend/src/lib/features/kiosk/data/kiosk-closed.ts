/** The code the server answers a kiosk work request with when an admin has closed the kiosk (403). */
export const KIOSK_CLOSED_CODE = 'KIOSK_CLOSED';

/**
 * True when a failed kiosk call was refused because the kiosk is closed. Every flow asks this one
 * question, so a closed kiosk is never mistaken for a switched-off method (`KIOSK_METHOD_DISABLED`).
 */
export function isKioskClosedError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error as { code: unknown }).code === KIOSK_CLOSED_CODE
	);
}
