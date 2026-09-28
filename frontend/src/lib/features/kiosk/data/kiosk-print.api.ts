/**
 * The scanner client answers this path itself and spools the PNGs to CUPS, so no print dialog
 * opens. Without a scanner client (plain dev browser) the request reaches SvelteKit, which has no
 * such route and answers 404 → the caller falls back to `window.print()`.
 */
export const KIOSK_PRINT_PATH = '/api/v1/scanner/kiosk/print';
const KIOSK_PRINT_TIMEOUT_MS = 30_000;

export type KioskPrintOutcome = { kind: 'printed'; printed: number } | { kind: 'unavailable' };

export class KioskPrintError extends Error {
	constructor(
		message: string,
		readonly printed: number
	) {
		super(message);
		this.name = 'KioskPrintError';
	}
}

/** Send base64 PNG labels (one per person) to the kiosk label printer. */
export async function printKioskLabels(
	labels: readonly string[],
	fetchFn: typeof fetch = fetch
): Promise<KioskPrintOutcome> {
	let response: Response;
	try {
		response = await fetchFn(KIOSK_PRINT_PATH, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			cache: 'no-store',
			body: JSON.stringify({ labels }),
			signal: AbortSignal.timeout(KIOSK_PRINT_TIMEOUT_MS)
		});
	} catch {
		throw new KioskPrintError('เชื่อมต่อเครื่องพิมพ์ไม่ได้ กรุณาลองอีกครั้ง', 0);
	}
	if (response.status === 404) return { kind: 'unavailable' };

	const body = (await response.json().catch(() => null)) as {
		printed?: unknown;
		error?: { message?: unknown };
	} | null;
	const printed = typeof body?.printed === 'number' ? body.printed : 0;
	if (!response.ok) {
		const message = body?.error?.message;
		throw new KioskPrintError(
			typeof message === 'string' ? message : 'ส่งงานพิมพ์ไม่สำเร็จ กรุณาลองอีกครั้ง',
			printed
		);
	}
	return { kind: 'printed', printed };
}
