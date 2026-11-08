/** A printer counts as online if the Pi polled within this window (plan §3.2). */
export const PRINTER_ONLINE_WINDOW_MS = 90_000;

export interface PrinterStatusInput {
	status: 'active' | 'inactive';
	last_seen_at: string | null;
	queue_state: 'ready' | 'disabled' | 'missing' | 'unknown';
}

/** Online = active, polled within 90 s of the server clock, and the CUPS queue is ready. */
export function isPrinterOnline(printer: PrinterStatusInput, serverNow: Date): boolean {
	if (printer.status !== 'active' || printer.queue_state !== 'ready') return false;
	if (printer.last_seen_at === null) return false;
	return serverNow.getTime() - Date.parse(printer.last_seen_at) <= PRINTER_ONLINE_WINDOW_MS;
}
