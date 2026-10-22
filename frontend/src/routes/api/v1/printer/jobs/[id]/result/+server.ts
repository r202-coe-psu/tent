import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { PrintJobConflictError, reportResult } from '$lib/server/printers/print-queue.server';
import { printDeviceRepository, printJobStore } from '$lib/server/printers/printer-server';
import {
	authenticateRequest,
	errorResponse,
	jobConflict,
	noStoreHeaders,
	validationFailed
} from '$lib/server/printers/printer-http';

export const prerender = false;

/** Agent-reported failures only; `agent_restart` / `lease_expired` are server-side. */
const resultSchema = z.object({
	printed: z.number().int().min(0),
	error_code: z.enum(['printer_timeout', 'queue_disabled', 'lp_failed']).optional()
});

export const POST: RequestHandler = async ({ request, params }) => {
	try {
		const { principal } = await authenticateRequest(request, printDeviceRepository);

		const body = resultSchema.safeParse(await request.json().catch(() => undefined));
		if (!body.success) return validationFailed();

		const status = await reportResult(
			printJobStore,
			principal.registry_id,
			params.id,
			body.data,
			new Date()
		);
		return json({ status }, { status: 200, headers: noStoreHeaders });
	} catch (error) {
		if (error instanceof PrintJobConflictError) return jobConflict();
		return errorResponse(error);
	}
};
