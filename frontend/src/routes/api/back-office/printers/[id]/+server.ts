import type { RequestHandler } from './$types';
import { ServiceError } from '$lib/server/session-auth';
import {
	deletePrinter,
	printDevicePatchSchema,
	updatePrinter
} from '$lib/server/printers/printer-admin.server';
import { printDeviceRepository } from '$lib/server/printers/print-device.repo';
import { printJobStoreFor } from '$lib/server/printers/print-job.service-store';
import { reprovisionShelterPrintingDb } from '$lib/server/printers/printing-provision';
import { requirePrinterManager } from '$lib/server/printers/printer-access';
import {
	assertPrinterInScope,
	noContent,
	noStoreJson,
	printerAdminError,
	printerDocId
} from '../_http';

export const prerender = false;

/** Delete a printer; its pending/printing jobs become `failed (printer_deleted)` first. */
export const DELETE: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await requirePrinterManager(request);
		const printerId = printerDocId(params.id);
		assertPrinterInScope(caller, await printDeviceRepository.getDevice(printerId));
		await deletePrinter(
			{ devices: printDeviceRepository, jobsFor: printJobStoreFor },
			printerId,
			new Date()
		);
		return noContent();
	} catch (e) {
		return printerAdminError(e);
	}
};

/** Rename / re-station / (de)activate a printer. Body is validated before the printer is read. */
export const PATCH: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await requirePrinterManager(request);
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
				{
					devices: printDeviceRepository,
					jobsFor: printJobStoreFor,
					ensureShelterDb: reprovisionShelterPrintingDb
				},
				printerId,
				parsed.data,
				new Date()
			)
		);
	} catch (e) {
		return printerAdminError(e);
	}
};
