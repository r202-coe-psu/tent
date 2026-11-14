import { createQuery } from '@tanstack/svelte-query';
import { findScannerClientPrinter } from '../data/scanner-client-print.api';
import { printerKeys } from './queries';

/** Re-checked this often, so a printer plugged in (or the app restarted) shows up on its own. */
export const SCANNER_CLIENT_PRINTER_REFETCH_MS = 30_000;

export const scannerClientPrinterKey = [...printerKeys.all, 'scanner-client'] as const;

/**
 * The USB printer of the scanner client this page runs in, or null (plain browser, or no printer
 * on this PC). Idle while `enabled` is false.
 */
export const useScannerClientPrinter = (enabled: () => boolean) =>
	createQuery(() => ({
		queryKey: scannerClientPrinterKey,
		queryFn: () => findScannerClientPrinter(),
		enabled: enabled(),
		retry: false,
		staleTime: SCANNER_CLIENT_PRINTER_REFETCH_MS,
		refetchInterval: SCANNER_CLIENT_PRINTER_REFETCH_MS
	}));
