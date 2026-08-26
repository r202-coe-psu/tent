import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { getShelterDb } from '$lib/db/shelter';
import { touch, type AuthorContext } from '$lib/db/model';
import { ConflictError } from '$lib/utils/errors';
import { isJob, jobSchema, makeJob, type Job, type JobInput } from '../domain/job.schema';
import {
	applyAccept,
	applyDecline,
	applyDispatch,
	assertQuotaInvariant,
	deriveJobStatus,
	type JobQuota
} from '../domain/quota';
import type { JobFilter, JobRepository } from './volunteer.repository';

/** Read-modify-write retries on CouchDB 409 before giving up (00-foundation §00.3). */
const MAX_QUOTA_RETRIES = 5;

/**
 * Last line of defence before every write: `createRemoteRepository.put` does
 * not validate, so an invalid shape (F-AUTO violated, quota invariant broken)
 * would otherwise persist and then be trusted by the application flow —
 * notably `initialStatusForSkills`, which reads `auto_accept`/`tier` off the
 * stored doc.
 */
function assertWritable(job: Job): Job {
	const parsed = jobSchema.parse(job) as Job;
	assertQuotaInvariant(parsed);
	return parsed;
}

/** Merge a transitioned `JobQuota` back onto the full `Job` doc it was read from. */
function mergeQuota(job: Job, quota: JobQuota): Job {
	return {
		...job,
		quota: quota.quota,
		slots_confirmed: quota.slots_confirmed,
		slots_dispatched: quota.slots_dispatched,
		slots_remaining: quota.slots_remaining
	};
}

/**
 * Remote CouchDB repository for the volunteers feature (`job` doc type).
 *
 * Quota mutations (`dispatch`/`acceptDispatch`/`declineDispatch`/`confirmSlot`)
 * are the single most important correctness surface here (00-foundation
 * §00.3): each is a read-modify-write against the latest `job` revision,
 * driven by the pure `domain/quota.ts` state transitions, asserting
 * `assertQuotaInvariant` right before every `put`, and retrying the whole
 * read-transition-write cycle when CouchDB answers 409 (another writer moved
 * the doc first) — up to `MAX_QUOTA_RETRIES` attempts.
 */
export class JobRemoteRepository implements JobRepository {
	private readonly repo: Repository;

	constructor(private readonly dbName: string) {
		this.repo = createRemoteRepository(dbName);
	}

	async list(filter?: JobFilter): Promise<Job[]> {
		let all = await this.repo.allByType('job', isJob);
		if (filter?.status) all = all.filter((j) => j.status === filter.status);
		if (filter?.tier) all = all.filter((j) => j.tier === filter.tier);
		if (filter?.isUrgent !== undefined) all = all.filter((j) => j.is_urgent === filter.isUrgent);
		return all;
	}

	async get(id: string): Promise<Job | null> {
		// Guard on read as `list()` does — a corrupt doc must not be invisible
		// in lists yet still drive the application flow.
		const doc = await this.repo.get<Job>(id);
		if (doc === null) return null;
		return isJob(doc) ? doc : null;
	}

	async create(input: JobInput, ctx: AuthorContext): Promise<Job> {
		return this.repo.put(assertWritable(makeJob(input, ctx)));
	}

	async update(job: Job): Promise<Job> {
		const latest = await this.repo.get<Job>(job._id);
		if (!latest) throw new Error(`ไม่พบงาน: ${job._id}`);
		const merged = touch({ ...job, _rev: latest._rev });
		// `status` is re-derived here too, so a metadata edit cannot leave a
		// full job sitting on `open` (F7 hole found in review round 2).
		return this.repo.put(assertWritable({ ...merged, status: deriveJobStatus(merged) }));
	}

	/**
	 * Read the latest `job`, apply a pure quota transition, assert the
	 * invariant, re-derive `status` from the new quota fill level
	 * (`domain/quota.ts#deriveJobStatus`, F7/CR-094 FR-VOL-13.2), and `put` —
	 * retrying the whole cycle on a 409 conflict.
	 */
	private async mutateQuota(
		jobId: string,
		transition: (quota: JobQuota) => JobQuota
	): Promise<Job> {
		let lastError: unknown;
		for (let attempt = 0; attempt < MAX_QUOTA_RETRIES; attempt++) {
			const current = await this.repo.get<Job>(jobId);
			if (!current) throw new Error(`ไม่พบงาน: ${jobId}`);

			const nextQuota = transition(current);
			assertQuotaInvariant(nextQuota);
			const merged = mergeQuota(current, nextQuota);
			const nextJob = assertWritable(touch({ ...merged, status: deriveJobStatus(merged) }));

			try {
				return await this.repo.put(nextJob);
			} catch (err) {
				lastError = err;
				if (err instanceof ConflictError) continue; // re-read latest _rev and retry
				throw err;
			}
		}
		throw lastError instanceof Error
			? lastError
			: new ConflictError(`mutateQuota: exceeded ${MAX_QUOTA_RETRIES} retries for ${jobId}`);
	}

	dispatch(jobId: string, count = 1): Promise<Job> {
		return this.mutateQuota(jobId, (quota) => applyDispatch(quota, count));
	}

	acceptDispatch(jobId: string, count = 1): Promise<Job> {
		return this.mutateQuota(jobId, (quota) => applyAccept(quota, count));
	}

	declineDispatch(jobId: string, count = 1): Promise<Job> {
		return this.mutateQuota(jobId, (quota) => applyDecline(quota, count));
	}

	/**
	 * Direct `remaining -> confirmed`, composed from the two pure transitions
	 * that already exist in `domain/quota.ts` (`applyDispatch` then
	 * `applyAccept`) — no new domain logic. Net effect: `slots_dispatched` is
	 * unchanged, `slots_remaining -1`, `slots_confirmed +1`.
	 */
	confirmSlot(jobId: string, count = 1): Promise<Job> {
		return this.mutateQuota(jobId, (quota) => applyAccept(applyDispatch(quota, count), count));
	}
}

let singleton: JobRepository | null = null;
let singletonDbName: string | null = null;

export function jobRepository(): JobRepository {
	const currentDb = getShelterDb();
	if (!singleton || singletonDbName !== currentDb) {
		singleton = new JobRemoteRepository(currentDb);
		singletonDbName = currentDb;
	}
	return singleton;
}

/** Test-only constructor that bypasses the `getShelterDb()` singleton. */
export function createJobRepositoryForTest(dbName: string): JobRemoteRepository {
	return new JobRemoteRepository(dbName);
}

/** Test-only: force `jobRepository()` to rebuild against the current mocked store. */
export function clearJobRepositoryCache(): void {
	singleton = null;
	singletonDbName = null;
}
