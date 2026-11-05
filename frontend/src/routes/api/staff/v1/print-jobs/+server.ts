import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { envelope, printErrorResponse } from '../_print-http';
import { readSessionUserCtx } from '$lib/server/session-auth';
import { createPrintJob } from '$lib/server/printers/print-jobs.server';
import { printDeviceRepository } from '$lib/server/printers/print-device.repo';
import { userJobStore } from '$lib/server/printers/print-job.user-store';
import { reprovisionShelterPrintingDb } from '$lib/server/printers/printing-provision';
// eslint-disable-next-line no-restricted-imports -- server-safe domain schema; feature barrel will pull client UI/query code
import { printJobCreateInputSchema } from '$lib/features/printers/domain/print-job.schema';

export const prerender = false;

const noStoreHeaders = { 'cache-control': 'no-store', pragma: 'no-cache' };

export const POST: RequestHandler = async ({ request }) => {
	try {
		const cookie = request.headers.get('cookie');
		const { name, roles } = await readSessionUserCtx(cookie);
		if (!name) return envelope(401, 'UNAUTHENTICATED', 'Authentication required');
		const body: unknown = await request.json().catch(() => null);
		const parsed = printJobCreateInputSchema.safeParse(body);
		if (!parsed.success) return envelope(422, 'INVALID_LABELS', 'Invalid print job request');

		// The job is written with the caller's own session: `_security` + the validation hook decide.
		const created = await createPrintJob(
			{
				devices: printDeviceRepository,
				storeFor: (shelterCode) => userJobStore(cookie, shelterCode),
				reprovisionShelterDb: reprovisionShelterPrintingDb
			},
			{ name, roles },
			parsed.data,
			new Date()
		);
		return json(created, { status: 201, headers: noStoreHeaders });
	} catch (e) {
		return printErrorResponse(e);
	}
};
