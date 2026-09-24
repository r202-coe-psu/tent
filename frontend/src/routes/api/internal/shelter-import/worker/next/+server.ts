import { json } from '@sveltejs/kit';
import { timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { ulid } from '$lib/db/ulid';
import { buildUpdatePayload } from '$lib/features/shelter-import';
import {
	claimNextImportItem,
	assertImportItemClaim,
	IMPORT_LEASE_MS,
	listRunnableImportJobs,
	MAX_IMPORT_ATTEMPTS,
	recomputeImportJob,
	renewImportItemClaim,
	resumePendingImportRetry,
	updateImportItem,
	type ImportItemError
} from '$lib/features/shelter-import/server/job-store';
import { findMasterByName, nowIso, updateMaster } from '$lib/server/shelters.admin';
import { allocateShelterCode, provisionShelter } from '$lib/features/shelters/server/provisioner';
import {
	acquireShelterNameLock,
	isShelterNameLockHeld,
	releaseShelterNameLock
} from '$lib/server/shelter-name-lock';

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

function hasValidWorkerToken(request: Request, expected: string): boolean {
	const authorization = request.headers.get('authorization') ?? '';
	const prefix = 'Bearer ';
	if (!authorization.startsWith(prefix)) return false;
	const received = Buffer.from(authorization.slice(prefix.length), 'utf8');
	const required = Buffer.from(expected, 'utf8');
	return received.length === required.length && timingSafeEqual(received, required);
}

/**
 * Claim and process exactly one import item. This endpoint is intentionally
 * token-authenticated rather than cookie-authenticated: it is only reachable
 * by the private import-worker service on the compose network.
 */
export const POST: RequestHandler = async ({ request }) => {
	const expected = env.SHELTER_IMPORT_WORKER_TOKEN;
	if (!expected || !hasValidWorkerToken(request, expected)) {
		return unauthorized();
	}

	const rawWorkerId = request.headers.get('x-shelter-import-worker-id');
	const WORKER_ID_REGEX = /^[A-Za-z0-9._:-]{1,128}$/;
	if (rawWorkerId !== null && !WORKER_ID_REGEX.test(rawWorkerId)) {
		return json(
			{ error: { code: 'VALIDATION', message: 'Invalid x-shelter-import-worker-id header' } },
			{ status: 400 }
		);
	}
	const workerId = rawWorkerId || `import-worker-${ulid()}`;
	try {
		const jobs = await listRunnableImportJobs();
		for (const job of jobs) {
			const jobId = job._id.slice('shelter_import_job:'.length);
			const claimedItem = await claimNextImportItem(jobId, workerId);
			if (!claimedItem) {
				if (job.retry_pending === true) {
					const resumedJob = await resumePendingImportRetry(jobId);
					if (resumedJob.status === 'completed' || resumedJob.status === 'completed_with_errors') {
						return json(
							{ jobId, itemId: null, job: resumedJob },
							{ headers: { 'cache-control': 'no-store, max-age=0' } }
						);
					}
					continue;
				}
				// A retry changes the job before requeueing its items. If the request
				// is interrupted in that window, the next worker call must reconcile
				// the running job instead of leaving it orphaned forever.
				if (
					job.status === 'queued' ||
					job.status === 'running' ||
					((job.status === 'completed' || job.status === 'completed_with_errors') &&
						job.audit_logged !== true)
				) {
					const reconciledJob = await recomputeImportJob(jobId);
					if (
						reconciledJob.status === 'completed' ||
						reconciledJob.status === 'completed_with_errors'
					) {
						return json(
							{ jobId, itemId: null, job: reconciledJob },
							{ headers: { 'cache-control': 'no-store, max-age=0' } }
						);
					}
				}
				continue;
			}
			let item = claimedItem;
			let lockedName: string | undefined;
			let nameLockAcquired = false;
			let leaseLost = false;
			let renewingClaim: Promise<void> | null = null;
			let leaseRenewalTimer: ReturnType<typeof setInterval> | undefined;
			const claimToken = item.claim_token;
			const lockOwnerId = `import:${jobId}:${item._id}:${claimToken ?? workerId}`;
			const renewClaim = (): Promise<void> => {
				if (leaseLost) return Promise.reject(new Error('Import item lease is no longer active'));
				if (renewingClaim) return renewingClaim;
				const renewal = (async () => {
					const renewed = await renewImportItemClaim(item);
					const lockRenewed = await acquireShelterNameLock({
						name: item.input?.name ?? item.name ?? '',
						ownerId: lockOwnerId,
						leaseMs: IMPORT_LEASE_MS
					});
					if (!lockRenewed) throw new Error('Shelter name lock is no longer held');
					item = renewed;
				})()
					.catch((error) => {
						leaseLost = true;
						throw error;
					})
					.finally(() => {
						renewingClaim = null;
					});
				renewingClaim = renewal;
				return renewal;
			};
			const assertActiveClaim = async () => {
				if (leaseLost) throw new Error('Import item lease is no longer active');
				await assertImportItemClaim(item);
				await renewClaim();
				await assertImportItemClaim(item);
				if (
					!(await isShelterNameLockHeld({
						name: item.input?.name ?? item.name ?? '',
						ownerId: lockOwnerId
					}))
				) {
					throw new Error('Shelter name lock is no longer held');
				}
			};

			try {
				const input = item.input;
				if (!input) throw new Error('Missing validated shelter payload');
				lockedName = input.name;
				nameLockAcquired = await acquireShelterNameLock({
					name: input.name,
					ownerId: lockOwnerId
				});
				if (!nameLockAcquired) {
					await updateImportItem(item, {
						status: 'pending',
						attempts: Math.max(0, item.attempts - 1),
						lease_until: undefined,
						worker_id: undefined,
						claim_token: undefined
					});
					const updatedJob = await recomputeImportJob(jobId);
					return json(
						{ jobId, itemId: item._id, job: updatedJob },
						{ headers: { 'cache-control': 'no-store, max-age=0' } }
					);
				}
				leaseRenewalTimer = setInterval(
					() => {
						renewClaim().catch(() => undefined);
					},
					Math.max(1000, Math.floor(IMPORT_LEASE_MS / 3))
				);
				await assertActiveClaim();
				const duplicate = await findMasterByName(input.name);
				const resumingProvision = Boolean(item.code);

				if (duplicate && !resumingProvision && job.duplicate_action === 'skip') {
					await updateImportItem(item, {
						status: 'skipped',
						code: duplicate.code,
						lease_until: undefined,
						worker_id: undefined,
						claim_token: undefined
					});
				} else if (duplicate && !resumingProvision && job.duplicate_action === 'update') {
					await assertActiveClaim();
					await updateMaster(
						duplicate.code,
						(current) => ({
							patch: {
								...buildUpdatePayload(input, current, {
									foodDistributionPointsProvided: item.food_distribution_points_present === true
								}),
								updated_at: nowIso()
							}
						}),
						{ assertActive: assertActiveClaim }
					);
					await updateImportItem(item, {
						status: 'updated',
						code: duplicate.code,
						lease_until: undefined,
						worker_id: undefined,
						claim_token: undefined
					});
				} else {
					// Re-read under the name lock immediately before allocating or
					// provisioning. A shelter may have been created after the first
					// duplicate scan while this item was being claimed.
					await assertActiveClaim();
					const duplicateBeforeProvision = resumingProvision
						? null
						: await findMasterByName(input.name);
					if (duplicateBeforeProvision && job.duplicate_action === 'skip') {
						await updateImportItem(item, {
							status: 'skipped',
							code: duplicateBeforeProvision.code,
							lease_until: undefined,
							worker_id: undefined,
							claim_token: undefined
						});
					} else if (duplicateBeforeProvision && job.duplicate_action === 'update') {
						await assertActiveClaim();
						await updateMaster(
							duplicateBeforeProvision.code,
							(current) => ({
								patch: {
									...buildUpdatePayload(input, current, {
										foodDistributionPointsProvided: item.food_distribution_points_present === true
									}),
									updated_at: nowIso()
								}
							}),
							{ assertActive: assertActiveClaim }
						);
						await updateImportItem(item, {
							status: 'updated',
							code: duplicateBeforeProvision.code,
							lease_until: undefined,
							worker_id: undefined,
							claim_token: undefined
						});
					} else {
						// Persist the code before touching the shelter DB. If the worker is
						// restarted after a partial provision, the retry must reuse this code.
						const allocatedCode = item.code ?? (await allocateShelterCode());
						await assertActiveClaim();
						if (item.code !== allocatedCode) {
							item = await updateImportItem(item, { code: allocatedCode });
							if (
								item.status !== 'running' ||
								item.worker_id !== workerId ||
								item.claim_token !== claimToken
							) {
								const updatedJob = await recomputeImportJob(jobId);
								return json(
									{ jobId, itemId: item._id, job: updatedJob },
									{ headers: { 'cache-control': 'no-store, max-age=0' } }
								);
							}
						}
						const result = await provisionShelter(input, allocatedCode, {
							lockOwnerId,
							assertActive: assertActiveClaim
						});
						await updateImportItem(item, {
							status: 'created',
							code: result.code,
							lease_until: undefined,
							worker_id: undefined,
							claim_token: undefined
						});
					}
				}
			} catch (error) {
				const terminalAttempt = item.attempts >= (item.max_attempts ?? MAX_IMPORT_ATTEMPTS);
				await updateImportItem(item, {
					status: 'failed',
					errors: itemError(error),
					lease_until: undefined,
					worker_id: undefined,
					claim_token: undefined,
					...(terminalAttempt ? { dead_lettered_at: new Date().toISOString() } : {})
				});
			} finally {
				if (leaseRenewalTimer) clearInterval(leaseRenewalTimer);
				// A timer callback may already be waiting on the name-lock CAS. Do
				// not release the lock until that renewal has settled, otherwise a
				// late renewal can reacquire it after cleanup and leave a stale lock.
				const pendingRenewal = renewingClaim as Promise<void> | null;
				if (pendingRenewal !== null) await pendingRenewal.catch(() => undefined);
				if (nameLockAcquired && lockedName) {
					await releaseShelterNameLock({ name: lockedName, ownerId: lockOwnerId }).catch(
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
