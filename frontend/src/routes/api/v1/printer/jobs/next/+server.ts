import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recordHeartbeat } from '$lib/server/printers/device-heartbeat';
import { sweepIfDue } from '$lib/server/printers/print-housekeeping.server';
import { waitForNextJob } from '$lib/server/printers/print-queue.server';
import { printDeviceRepository } from '$lib/server/printers/print-device.repo';
import { printJobStoreFor } from '$lib/server/printers/print-job.service-store';
import {
	authenticateRequest,
	errorResponse,
	noStoreHeaders,
	parseQueueState,
	readJsonObject
} from '$lib/server/printers/printer-http';

export const prerender = false;

const WAIT_MS = 25_000;

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { principal, device } = await authenticateRequest(request, printDeviceRepository);
		const queueState = parseQueueState((await readJsonObject(request)).queue_state);
		await recordHeartbeat(printDeviceRepository, device, {
			queue_state: queueState,
			now: new Date()
		});
		const store = printJobStoreFor(principal.shelter_code);
		await sweepIfDue(store, principal.shelter_code, new Date());
		if (queueState !== 'ready') return new Response(null, { status: 204, headers: noStoreHeaders });

		const claimed = await waitForNextJob(store, principal.registry_id, {
			shelterCode: principal.shelter_code,
			now: () => new Date(),
			waitMs: WAIT_MS,
			signal: request.signal
		});
		if (!claimed) return new Response(null, { status: 204, headers: noStoreHeaders });
		return json(claimed, { status: 200, headers: noStoreHeaders });
	} catch (error) {
		return errorResponse(error);
	}
};
