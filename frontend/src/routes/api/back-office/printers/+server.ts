import type { RequestHandler } from './$types';
import { ServiceError } from '$lib/server/session-auth';
import {
	createPrinter,
	listPrinters,
	printDeviceInputSchema
} from '$lib/server/printers/printer-admin.server';
import { printDeviceRepository } from '$lib/server/printers/print-device.repo';
import { printJobStoreFor } from '$lib/server/printers/print-job.service-store';
import { reprovisionShelterPrintingDb } from '$lib/server/printers/printing-provision';
import { scannerDeviceRepository } from '$lib/server/scanners/device-repository';
import {
	assertCanCreatePrinterFor,
	requirePrinterManager
} from '$lib/server/printers/printer-access';
import { scopedShelterFilter } from '$lib/server/shelter-capability-access';
import { noStoreJson, printerAdminError } from './_http';

export const prerender = false;

export const GET: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await requirePrinterManager(request);
		const scope = scopedShelterFilter(caller, url.searchParams.get('shelter_code'));
		if (scope?.length === 0) {
			throw new ServiceError('FORBIDDEN', 'Not a shelter_manager of this shelter');
		}
		const list = await listPrinters(
			{ devices: printDeviceRepository, jobsFor: printJobStoreFor },
			scope,
			new Date()
		);
		return noStoreJson(list);
	} catch (e) {
		return printerAdminError(e);
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const caller = await requirePrinterManager(request);

		const body: unknown = await request.json().catch(() => ({}));
		const parsed = printDeviceInputSchema.safeParse(body);
		if (!parsed.success) {
			throw new ServiceError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid printer');
		}

		assertCanCreatePrinterFor(caller, parsed.data.shelter_code);

		const created = await createPrinter(
			{
				store: printDeviceRepository,
				scanners: scannerDeviceRepository,
				ensureShelterDb: reprovisionShelterPrintingDb
			},
			parsed.data,
			caller.name,
			new Date()
		);
		return noStoreJson(created, 201);
	} catch (e) {
		return printerAdminError(e);
	}
};
