import { json } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { ulid } from '$lib/db/ulid';
import { resolveOperationStatus } from '$lib/features/shelters/server';
import { findMasterByCode, migrate, updateMaster } from '$lib/server/shelters.admin';
import { adminCouchReq, getShelterCloseStore } from '$lib/server/shelter-close-job-runtime';
import { runShelterCloseWorkerStep } from '$lib/server/shelter-close-worker-run';
import { recordAuditedWrite } from '$lib/server/audit-log';
import { AUDIT_EVENTS } from '$lib/features/audit-log/server';

export const prerender = false;

const WORKER_ID_REGEX = /^[A-Za-z0-9._:-]{1,128}$/;

function hasValidWorkerToken(request: Request, expected: string): boolean {
	const authorization = request.headers.get('authorization') ?? '';
	const prefix = 'Bearer ';
	if (!authorization.startsWith(prefix)) return false;
	const received = Buffer.from(authorization.slice(prefix.length), 'utf8');
	const required = Buffer.from(expected, 'utf8');
	return received.length === required.length && timingSafeEqual(received, required);
}

/**
 * CR-243 FR-11..FR-14: claim or continue one close job, run ONE chunk, persist the cursor.
 * Token-authenticated (no cookie): only the private `shelter-close-worker` service reaches it
 * (nginx denies `/api/internal/shelter-close/worker/` on the public listener, FR-37).
 * `401` bad / missing token · `204` nothing to do · `200` one chunk processed.
 */
export const POST: RequestHandler = async ({ request }) => {
	const expected = env.SHELTER_CLOSE_WORKER_TOKEN;
	if (!expected || !hasValidWorkerToken(request, expected)) {
		return json(
			{ error: { code: 'UNAUTHORIZED', message: 'Invalid shelter close worker token' } },
			{ status: 401 }
		);
	}
	const rawWorkerId = request.headers.get('x-shelter-close-worker-id');
	if (rawWorkerId !== null && !WORKER_ID_REGEX.test(rawWorkerId)) {
		return json(
			{ error: { code: 'VALIDATION', message: 'Invalid x-shelter-close-worker-id header' } },
			{ status: 400 }
		);
	}
	const workerId = rawWorkerId || `close-worker-${ulid()}`;

	try {
		const result = await runShelterCloseWorkerStep({
			store: getShelterCloseStore(),
			couchReq: adminCouchReq,
			workerId,
			readShelter: async (code) => {
				const master = await findMasterByCode(code);
				if (!master) return null;
				const shelter = migrate(master);
				return {
					closed: resolveOperationStatus(shelter) === 'closed',
					closed_at: typeof shelter.closed_at === 'string' ? shelter.closed_at : null
				};
			},
			closeShelter: async (code, actor) => {
				const { before, after } = await updateMaster(code, actor, () => ({
					patch: { operation_status: 'closed' }
				}));
				await recordAuditedWrite({
					actor,
					event: AUDIT_EVENTS.shelterClosed,
					action: 'status_change',
					entityType: 'shelter',
					entityId: code,
					label: after.name,
					shelterCode: code,
					before: before as Record<string, unknown> | undefined,
					after: after as Record<string, unknown> | undefined
				});
			}
		});
		if (result.kind === 'idle') return new Response(null, { status: 204 });
		const { job } = result;
		return json(
			{
				job_id: job.job_ulid,
				shelter_code: job.shelter_code,
				status: job.status,
				phase: job.phase,
				counters: job.counters,
				stopped: result.stopped,
				budget_exceeded: result.budget_exceeded
			},
			{ headers: { 'cache-control': 'no-store, max-age=0' } }
		);
	} catch (error) {
		return json(
			{
				error: {
					code: 'INTERNAL',
					message: error instanceof Error ? error.message : 'Worker request failed'
				}
			},
			{ status: 500 }
		);
	}
};
