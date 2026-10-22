import type { RequestHandler } from './$types';
import { ServiceError } from '$lib/server/couch-admin';
import {
	createPrinter,
	listPrinters,
	printDeviceInputSchema
} from '$lib/server/printers/printer-admin.server';
import { printDeviceRepository, printJobStore } from '$lib/server/printers/printer-server';
import { assertCanCreateFor, requireScannerManager } from '$lib/server/scanners/scanner-access';
import { scopedShelterFilter } from '$lib/server/shelter-capability-access';
import { noStoreJson, printerAdminError } from './_http';

export const prerender = false;

export const GET: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await requireScannerManager(request);
		const scope = scopedShelterFilter(caller, url.searchParams.get('shelter_code'));
		if (scope?.length === 0) {
			throw new ServiceError('FORBIDDEN', 'Not a shelter_manager or kiosk_staff of this shelter');
		}
		const list = await listPrinters(
			{ devices: printDeviceRepository, jobs: printJobStore },
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
		const caller = await requireScannerManager(request);

		const body: unknown = await request.json().catch(() => ({}));
		const parsed = printDeviceInputSchema.safeParse(body);
		if (!parsed.success) {
			throw new ServiceError('VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid printer');
		}

		assertCanCreateFor(caller, parsed.data.shelter_code);

		const created = await createPrinter(
			printDeviceRepository,
			parsed.data,
			caller.name,
			new Date()
		);
		return noStoreJson(created, 201);
	} catch (e) {
		return printerAdminError(e);
	}
};
