/**
 * Labels printed on the USB label printer of the PC running the scanner client (the desktop app
 * that opens this site in Edge at the registration desk). The scanner client answers both paths
 * itself and never forwards them to the server; in a plain browser they do not exist (404), so
 * `findScannerClientPrinter` is null and nothing here is offered.
 *
 * Independent of the print server (`printers.api.ts`): no job, no device, no shelter printer list.
 * Contract: scanner-client/scanner_client/label_print.py.
 */
import type { ScannerClientPrintErrorCode } from '../domain/scanner-client-print.i18n';

export const SCANNER_CLIENT_PRINTER_PATH = '/api/v1/scanner-client/printer';
export const SCANNER_CLIENT_PRINT_PATH = '/api/v1/scanner-client/print';
/**
 * The scanner client takes 1–20 labels per request but stops starting labels after 25 s; 8 per
 * request keeps each one inside that and inside the 30 s timeout below.
 */
export const SCANNER_CLIENT_LABELS_PER_REQUEST = 8;
const PRINT_TIMEOUT_MS = 30_000;
const FIND_TIMEOUT_MS = 3_000;

export type ScannerClientPrinter = { name: string };

const KNOWN_CODES: readonly ScannerClientPrintErrorCode[] = [
	'PRINTER_NOT_FOUND',
	'PRINT_FAILED',
	'PRINT_TIMEOUT',
	'INVALID_LABELS'
];

export class ScannerClientPrintError extends Error {
	constructor(
		readonly code: ScannerClientPrintErrorCode,
		/** Labels printed before the failure, across every request of this print. */
		readonly printed: number
	) {
		super(`Scanner client print failed: ${code}`);
		this.name = 'ScannerClientPrintError';
	}
}

/** The scanner client's printer, or null without a scanner client or without the printer. */
export async function findScannerClientPrinter(
	fetchFn: typeof fetch = fetch
): Promise<ScannerClientPrinter | null> {
	try {
		const response = await fetchFn(SCANNER_CLIENT_PRINTER_PATH, {
			method: 'POST',
			cache: 'no-store',
			signal: AbortSignal.timeout(FIND_TIMEOUT_MS)
		});
		if (!response.ok) return null;
		const body = (await response.json().catch(() => null)) as {
			available?: unknown;
			name?: unknown;
		} | null;
		if (body?.available !== true || typeof body.name !== 'string') return null;
		return { name: body.name };
	} catch {
		return null;
	}
}

/**
 * Print every label, at most `SCANNER_CLIENT_LABELS_PER_REQUEST` per request, one request after
 * the other. Resolves with the number printed; a failure stops the rest and throws
 * `ScannerClientPrintError` with every label printed so far.
 */
export async function printOnScannerClient(
	labels: readonly string[],
	fetchFn: typeof fetch = fetch
): Promise<number> {
	let printed = 0;
	for (let start = 0; start < labels.length; start += SCANNER_CLIENT_LABELS_PER_REQUEST) {
		const batch = labels.slice(start, start + SCANNER_CLIENT_LABELS_PER_REQUEST);
		let response: Response;
		try {
			response = await fetchFn(SCANNER_CLIENT_PRINT_PATH, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				cache: 'no-store',
				body: JSON.stringify({ labels: batch }),
				signal: AbortSignal.timeout(PRINT_TIMEOUT_MS)
			});
		} catch {
			throw new ScannerClientPrintError('connection', printed);
		}
		const body = (await response.json().catch(() => null)) as {
			printed?: unknown;
			error?: { code?: unknown };
		} | null;
		const count = typeof body?.printed === 'number' ? body.printed : 0;
		if (!response.ok) {
			const code = KNOWN_CODES.find((known) => known === body?.error?.code) ?? 'connection';
			throw new ScannerClientPrintError(code, printed + count);
		}
		printed += count;
	}
	return printed;
}
