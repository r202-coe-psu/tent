import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { envelope, printErrorResponse } from '../_print-http';
import { requireShelterScopeOrSA } from '$lib/server/couch-admin';
import { createPrintJob } from '$lib/server/printers/print-jobs.server';
import { printDeviceRepository, printJobStore } from '$lib/server/printers/printer-server';
// eslint-disable-next-line no-restricted-imports -- server-safe domain schema; feature barrel will pull client UI/query code
import { printJobCreateInputSchema } from '$lib/features/printers/domain/print-job.schema';

export const prerender = false;

const noStoreHeaders = { 'cache-control': 'no-store', pragma: 'no-cache' };

export const POST: RequestHandler = async ({ request }) => {
	try {
		const cookie = request.headers.get('cookie');
		const caller = await requireShelterScopeOrSA(cookie);
		const body: unknown = await request.json().catch(() => null);
		const parsed = printJobCreateInputSchema.safeParse(body);
		if (!parsed.success) return envelope(422, 'INVALID_LABELS', 'Invalid print job request');

		const created = await createPrintJob(
			{ store: printJobStore, devices: printDeviceRepository },
			{
				name: caller.name,
				assertShelterAccess: async (shelterCode) => {
					await requireShelterScopeOrSA(cookie, shelterCode);
				}
			},
			parsed.data,
			new Date()
		);
		return json(created, { status: 201, headers: noStoreHeaders });
	} catch (e) {
		return printErrorResponse(e);
	}
};
