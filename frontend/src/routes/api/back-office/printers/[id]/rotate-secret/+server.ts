import type { RequestHandler } from './$types';
import { rotatePrinterSecret } from '$lib/server/printers/printer-admin.server';
import { printDeviceRepository } from '$lib/server/printers/printer-server';
import { requirePrinterManager } from '$lib/server/printers/printer-access';
import { assertPrinterInScope, noStoreJson, printerAdminError, printerDocId } from '../../_http';

export const prerender = false;

/** Issue a new secret; the old one stops authenticating immediately. The secret is shown once. */
export const POST: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await requirePrinterManager(request);
		const printerId = printerDocId(params.id);
		assertPrinterInScope(caller, await printDeviceRepository.getDevice(printerId));
		return noStoreJson(await rotatePrinterSecret(printDeviceRepository, printerId, new Date()));
	} catch (e) {
		return printerAdminError(e);
	}
};
