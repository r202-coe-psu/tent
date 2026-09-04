import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { getShelterDb } from '$lib/db/shelter';
import { touch, type AuthorContext } from '$lib/db/model';
import { ConflictError } from '$lib/utils/errors';
import {
	isJob,
	jobSchema,
	makeJob,
	withNormalizedJobStatus,
	type Job,
	type JobInput
} from '../domain/job.schema';
import {
	applyAccept,
	applyDecline,
	applyDispatch,
	applyRelease,
	assertQuotaInvariant,
	deriveJobStatus,
	QuotaError,
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
		// Normalise first: the guard runs against the raw doc, so a legacy
		// `almost_full` job would otherwise be filtered out of every list.
		let all = await this.repo.allByType(
			'job',
			(d): d is Job => typeof d === 'object' && d !== null && isJob(withNormalizedJobStatus(d))
		);
		all = all.map(withNormalizedJobStatus);
		if (filter?.status) all = all.filter((j) => j.status === filter.status);
		if (filter?.tier) all = all.filter((j) => j.tier === filter.tier);
		if (filter?.isUrgent !== undefined) all = all.filter((j) => j.is_urgent === filter.isUrgent);
		return all;
	}

	async get(id: string): Promise<Job | null> {
		// Guard on read as `list()` does — a corrupt doc must not be invisible
		// in lists yet still drive the application flow.
		const raw = await this.repo.get<Job>(id);
		if (raw === null) return null;
		const doc = withNormalizedJobStatus(raw);
		return isJob(doc) ? doc : null;
	}

	async create(input: JobInput, ctx: AuthorContext): Promise<Job> {
		return this.repo.put(assertWritable(makeJob(input, ctx)));
	}

	async update(job: Job): Promise<Job> {
		let lastError: unknown;
		for (let attempt = 0; attempt < MAX_QUOTA_RETRIES; attempt++) {
			const latest = await this.repo.get<Job>(job._id);
			if (!latest) throw new Error(`ไม่พบงาน: ${job._id}`);

			const claimed = latest.slots_confirmed + latest.slots_dispatched;
			if (job.quota < claimed) {
				throw new QuotaError(`จำนวนรับรวม ${job.quota} คน น้อยกว่าที่รับไปแล้ว ${claimed} คน`);
			}

			const merged: Job = {
				...job,
				_rev: latest._rev,
				slots_confirmed: latest.slots_confirmed,
				slots_dispatched: latest.slots_dispatched,
				slots_remaining: job.quota - claimed
			};
			// `status` is NOT re-derived here: this path carries the SM's explicit
			// LIFECYCLE pick, and re-deriving would overwrite it in the same `put`
			// (owner decision 2026-09-04). Automatic `open`/`full` still comes from
			// `mutateQuota` on the next dispatch/accept/decline.
			const nextJob = assertWritable(touch(merged));

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
			: new ConflictError(`update: exceeded ${MAX_QUOTA_RETRIES} retries for ${job._id}`);
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
			const stored = await this.repo.get<Job>(jobId);
			if (!stored) throw new Error(`ไม่พบงาน: ${jobId}`);
			const current = withNormalizedJobStatus(stored);

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

	/** Direct `confirmed -> remaining` (`applyRelease`) — the inverse of {@link confirmSlot}. */
	releaseSlot(jobId: string, count = 1): Promise<Job> {
		return this.mutateQuota(jobId, (quota) => applyRelease(quota, count));
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
