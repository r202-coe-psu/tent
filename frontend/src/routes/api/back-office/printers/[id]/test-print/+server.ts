import type { RequestHandler } from './$types';
import { queueTestPrint } from '$lib/server/printers/printer-admin.server';
import { printDeviceRepository } from '$lib/server/printers/print-device.repo';
import { userJobStore } from '$lib/server/printers/print-job.user-store';
import { reprovisionShelterPrintingDb } from '$lib/server/printers/printing-provision';
import { requirePrinterManager } from '$lib/server/printers/printer-access';
import { assertPrinterInScope, noStoreJson, printerAdminError, printerDocId } from '../../_http';

export const prerender = false;

/**
 * Queue a one-label test print (built-in label, no personal data); the printer must be online.
 * The job is written with the caller's own session, so the DB's validation hook has the final say.
 */
export const POST: RequestHandler = async ({ request, params }) => {
	try {
		const cookie = request.headers.get('cookie');
		const caller = await requirePrinterManager(request);
		const printerId = printerDocId(params.id);
		assertPrinterInScope(caller, await printDeviceRepository.getDevice(printerId));
		const queued = await queueTestPrint(
			{
				devices: printDeviceRepository,
				storeFor: (shelterCode) => userJobStore(cookie, shelterCode),
				reprovisionShelterDb: reprovisionShelterPrintingDb
			},
			printerId,
			{ name: caller.name, roles: caller.roles },
			new Date()
		);
		return noStoreJson(queued, 201);
	} catch (e) {
		return printerAdminError(e);
	}
};
