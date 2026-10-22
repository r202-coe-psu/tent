import type { RequestHandler } from './$types';
import { ServiceError } from '$lib/server/couch-admin';
import {
	deletePrinter,
	printDevicePatchSchema,
	updatePrinter
} from '$lib/server/printers/printer-admin.server';
import { printDeviceRepository, printJobStore } from '$lib/server/printers/printer-server';
import { requireScannerManager } from '$lib/server/scanners/scanner-access';
import {
	assertPrinterInScope,
	noContent,
	noStoreJson,
	printerAdminError,
	printerDocId
} from '../_http';

export const prerender = false;

/** Rename / re-station / (de)activate a printer. Body is validated before the printer is read. */
/** Delete a printer; its pending/printing jobs become `failed (printer_deleted)` first. */
export const DELETE: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await requireScannerManager(request);
		const printerId = printerDocId(params.id);
		assertPrinterInScope(caller, await printDeviceRepository.getDevice(printerId));
		await deletePrinter(
			{ devices: printDeviceRepository, jobs: printJobStore },
			printerId,
			new Date()
		);
		return noContent();
	} catch (e) {
		return printerAdminError(e);
	}
};

export const PATCH: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await requireScannerManager(request);
		const printerId = printerDocId(params.id);

		const body: unknown = await request.json().catch(() => null);
		const parsed = printDevicePatchSchema.safeParse(body);
		if (!parsed.success) {
			throw new ServiceError(
				'VALIDATION',
				parsed.error.issues[0]?.message ?? 'Invalid printer update'
			);
		}

		assertPrinterInScope(caller, await printDeviceRepository.getDevice(printerId));
		return noStoreJson(
			await updatePrinter(
				{ devices: printDeviceRepository, jobs: printJobStore },
				printerId,
				parsed.data,
				new Date()
			)
		);
	} catch (e) {
		return printerAdminError(e);
	}
};
