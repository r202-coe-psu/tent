/**
 * The scanner client answers this path itself and spools the PNGs to CUPS, so no print dialog
 * opens. Without a scanner client (plain dev browser) the request reaches SvelteKit, which has no
 * such route and answers 404 → the caller falls back to `window.print()`.
 */
export const KIOSK_PRINT_PATH = '/api/v1/scanner/kiosk/print';
const KIOSK_PRINT_TIMEOUT_MS = 30_000;
/**
 * Labels per print request. The scanner client takes 1–20 (`KIOSK_PRINT_MAX_LABELS`), but each
 * request also has a 25 s deadline and ESC/POS waits 2 s between labels, which fits about 10; 8
 * keeps every request inside both limits so a household of any size prints in full.
 */
export const KIOSK_PRINT_MAX_LABELS_PER_REQUEST = 8;

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

/**
 * Send base64 PNG labels (one per person) to the kiosk label printer, at most
 * `KIOSK_PRINT_MAX_LABELS_PER_REQUEST` per request, one request after the other. A failure stops
 * the rest and reports every label already printed, including those of earlier requests.
 */
export async function printKioskLabels(
	labels: readonly string[],
	fetchFn: typeof fetch = fetch
): Promise<KioskPrintOutcome> {
	if (labels.length <= KIOSK_PRINT_MAX_LABELS_PER_REQUEST) {
		return printKioskLabelChunk(labels, fetchFn);
	}
	let printed = 0;
	for (let start = 0; start < labels.length; start += KIOSK_PRINT_MAX_LABELS_PER_REQUEST) {
		const chunk = labels.slice(start, start + KIOSK_PRINT_MAX_LABELS_PER_REQUEST);
		let outcome: KioskPrintOutcome;
		try {
			outcome = await printKioskLabelChunk(chunk, fetchFn);
		} catch (error) {
			if (error instanceof KioskPrintError) {
				throw new KioskPrintError(error.message, printed + error.printed);
			}
			throw error;
		}
		if (outcome.kind === 'unavailable') {
			// No scanner client at all: let the caller fall back to the browser print dialog.
			if (printed === 0) return outcome;
			throw new KioskPrintError('เชื่อมต่อเครื่องพิมพ์ไม่ได้ กรุณาลองอีกครั้ง', printed);
		}
		printed += outcome.printed;
	}
	return { kind: 'printed', printed };
}

async function printKioskLabelChunk(
	labels: readonly string[],
	fetchFn: typeof fetch
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
