import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { ulid } from '$lib/db/ulid';
import { buildUpdatePayload, normalizeShelterName } from '$lib/features/shelter-import';
import {
	acquireImportNameLock,
	claimNextImportItem,
	listRunnableImportJobs,
	recomputeImportJob,
	releaseImportNameLock,
	updateImportItem,
	type ImportItemError
} from '$lib/features/shelter-import/server/job-store';
import {
	findMasterByCode,
	listShelterMasters,
	nowIso,
	updateMaster
} from '$lib/server/shelters.admin';
import { allocateShelterCode, provisionShelter } from '$lib/features/shelters/server/provisioner';

export const prerender = false;

function unauthorized() {
	return json(
		{ error: { code: 'UNAUTHORIZED', message: 'Invalid import worker token' } },
		{ status: 401 }
	);
}

function itemError(error: unknown): ImportItemError[] {
	return [
		{
			column: '-',
			message: error instanceof Error ? error.message : 'Import item failed'
		}
	];
}

/**
 * Claim and process exactly one import item. This endpoint is intentionally
 * token-authenticated rather than cookie-authenticated: it is only reachable
 * by the private import-worker service on the compose network.
 */
export const POST: RequestHandler = async ({ request }) => {
	const expected = env.SHELTER_IMPORT_WORKER_TOKEN;
	if (!expected || request.headers.get('x-shelter-import-worker-token') !== expected) {
		return unauthorized();
	}

	const workerId = request.headers.get('x-shelter-import-worker-id') || `import-worker-${ulid()}`;
	try {
		const jobs = await listRunnableImportJobs();
		for (const job of jobs) {
			let item = await claimNextImportItem(job._id.slice('shelter_import_job:'.length), workerId);
			if (!item) continue;
			const jobId = job._id.slice('shelter_import_job:'.length);
			let lockedName: string | undefined;
			let nameLockAcquired = false;

			try {
				const input = item.input;
				if (!input) throw new Error('Missing validated shelter payload');
				lockedName = input.name;
				nameLockAcquired = await acquireImportNameLock({
					name: input.name,
					jobId,
					itemId: item._id,
					workerId
				});
				if (!nameLockAcquired) {
					await updateImportItem(item, {
						status: 'pending',
						lease_until: undefined,
						worker_id: undefined
					});
					const updatedJob = await recomputeImportJob(jobId);
					return json(
						{ jobId, itemId: item._id, job: updatedJob },
						{ headers: { 'cache-control': 'no-store, max-age=0' } }
					);
				}
				const masters = await listShelterMasters();
				const duplicate = masters.find(
					(master) => normalizeShelterName(master.name) === normalizeShelterName(input.name)
				);

				if (duplicate && job.duplicate_action === 'skip') {
					await updateImportItem(item, {
						status: 'skipped',
						code: duplicate.code,
						lease_until: undefined,
						worker_id: undefined
					});
				} else if (duplicate && job.duplicate_action === 'update') {
					const existing = await findMasterByCode(duplicate.code);
					const payload = buildUpdatePayload(input, existing);
					await updateMaster(duplicate.code, () => ({
						patch: { ...payload, updated_at: nowIso() }
					}));
					await updateImportItem(item, {
						status: 'updated',
						code: duplicate.code,
						lease_until: undefined,
						worker_id: undefined
					});
				} else {
					// Persist the code before touching the shelter DB. If the worker is
					// restarted after a partial provision, the retry must reuse this code.
					const allocatedCode = item.code ?? (await allocateShelterCode());
					if (item.code !== allocatedCode) {
						item = await updateImportItem(item, { code: allocatedCode });
						if (item.status !== 'running' || item.worker_id !== workerId) {
							const updatedJob = await recomputeImportJob(jobId);
							return json(
								{ jobId, itemId: item._id, job: updatedJob },
								{ headers: { 'cache-control': 'no-store, max-age=0' } }
							);
						}
					}
					const result = await provisionShelter(input, allocatedCode);
					await updateImportItem(item, {
						status: 'created',
						code: result.code,
						lease_until: undefined,
						worker_id: undefined
					});
				}
			} catch (error) {
				await updateImportItem(item, {
					status: 'failed',
					errors: itemError(error),
					lease_until: undefined,
					worker_id: undefined
				});
			} finally {
				if (nameLockAcquired && lockedName) {
					await releaseImportNameLock({ name: lockedName, jobId, itemId: item._id }).catch(
						() => undefined
					);
				}
			}

			const updatedJob = await recomputeImportJob(jobId);
			return json(
				{ jobId, itemId: item._id, job: updatedJob },
				{ headers: { 'cache-control': 'no-store, max-age=0' } }
			);
		}

		return new Response(null, { status: 204 });
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
