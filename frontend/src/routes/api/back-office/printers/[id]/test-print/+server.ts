import type { RequestHandler } from './$types';
import { queueTestPrint } from '$lib/server/printers/printer-admin.server';
import { printDeviceRepository, printJobStore } from '$lib/server/printers/printer-server';
import { requireScannerManager } from '$lib/server/scanners/scanner-access';
import { assertPrinterInScope, noStoreJson, printerAdminError, printerDocId } from '../../_http';

export const prerender = false;

/** Queue a one-label test print (built-in label, no personal data); the printer must be online. */
export const POST: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await requireScannerManager(request);
		const printerId = printerDocId(params.id);
		assertPrinterInScope(caller, await printDeviceRepository.getDevice(printerId));
		const queued = await queueTestPrint(
			{ store: printJobStore, devices: printDeviceRepository },
			printerId,
			caller.name,
			new Date()
		);
		return noStoreJson(queued, 201);
	} catch (e) {
		return printerAdminError(e);
	}
};
