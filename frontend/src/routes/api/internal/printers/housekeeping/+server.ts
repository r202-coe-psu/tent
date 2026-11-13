import { json } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import {
	compactDevicesDb,
	listRegisteredShelters,
	readHousekeepingState,
	writeHousekeepingState
} from '$lib/server/printers/print-device.repo';
import { printJobStoreFor } from '$lib/server/printers/print-job.service-store';
import { runHousekeeping } from '$lib/server/printers/print-housekeeping.server';

export const prerender = false;

const noStore = { 'cache-control': 'no-store' };

function hasValidToken(request: Request, expected: string): boolean {
	const authorization = request.headers.get('authorization') ?? '';
	const prefix = 'Bearer ';
	if (!authorization.startsWith(prefix)) return false;
	const received = Buffer.from(authorization.slice(prefix.length), 'utf8');
	const required = Buffer.from(expected, 'utf8');
	return received.length === required.length && timingSafeEqual(received, required);
}

/**
 * Print housekeeping tick (FR-17, FR-34a): sweep every registered shelter's jobs and, once an
 * hour, apply retention + compaction. Called by the sync worker (`worker` service,
 * `worker/src/worker/printing/housekeeping.py`) with
 * `Authorization: Bearer <PRINT_HOUSEKEEPING_TOKEN>`; never by a browser (nginx answers 404 for
 * `/api/internal/printers/`). Fail closed: no token configured -> 503, so it cannot run open.
 */
export const POST: RequestHandler = async ({ request }) => {
	const expected = env.PRINT_HOUSEKEEPING_TOKEN;
	if (!expected) {
		return json(
			{
				error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Print housekeeping is not configured' }
			},
			{ status: 503, headers: noStore }
		);
	}
	if (!hasValidToken(request, expected)) {
		return json(
			{ error: { code: 'UNAUTHORIZED', message: 'Invalid print housekeeping token' } },
			{ status: 401, headers: noStore }
		);
	}

	const result = await runHousekeeping({
		listShelters: listRegisteredShelters,
		storeFor: printJobStoreFor,
		devices: { compactDevicesDb, readHousekeepingState, writeHousekeepingState },
		now: new Date()
	});
	return json(result, { headers: noStore });
};
