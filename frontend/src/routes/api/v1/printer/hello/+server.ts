import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recordHeartbeat } from '$lib/server/printers/device-heartbeat';
import { failInFlight } from '$lib/server/printers/print-queue.server';
// eslint-disable-next-line no-restricted-imports -- server-safe domain rule; feature barrel will pull client UI/query code
import { leaseSecFor } from '$lib/features/printers/domain/print-job-timing';
import { printDeviceRepository, printJobStore } from '$lib/server/printers/printer-server';
import {
	authenticateRequest,
	errorResponse,
	noStoreHeaders,
	parseQueueState,
	readJsonObject
} from '$lib/server/printers/printer-http';

export const prerender = false;

/** `lease_sec` is the 1-label lease: the agent's fallback when a claim carries no `lease_sec`. */
const CONFIG = { wait_sec: 25, lease_sec: leaseSecFor(1) };

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { principal, device } = await authenticateRequest(request, printDeviceRepository);
		const body = await readJsonObject(request);
		const now = new Date();

		await failInFlight(printJobStore, principal.registry_id, now);
		await recordHeartbeat(printDeviceRepository, device, {
			queue_state: parseQueueState(body.queue_state),
			agent_version: typeof body.agent_version === 'string' ? body.agent_version : undefined,
			now,
			force: true
		});

		return json(
			{
				device: {
					device_id: principal.device_id,
					name: principal.name,
					shelter_code: principal.shelter_code
				},
				server_time: now.toISOString(),
				config: CONFIG
			},
			{ status: 200, headers: noStoreHeaders }
		);
	} catch (error) {
		return errorResponse(error);
	}
};
