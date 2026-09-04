import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { getShelterDb } from '$lib/db/shelter';
import { touch, type AuthorContext } from '$lib/db/model';
import {
	isJobApplication,
	jobApplicationSchema,
	makeJobApplication,
	canTransitionJobApplication,
	type JobApplication,
	type JobApplicationInput,
	type JobApplicationStatus
} from '../domain/job-application.schema';
import { initialStatusForSkills } from '../domain/skills';
import { jobRepository } from './job.remote';
import type { JobApplicationFilter, JobApplicationRepository } from './volunteer.repository';

/**
 * Remote CouchDB repository for the volunteers feature (`job_application` doc
 * type). Depends on `jobRepository()` for the job-slot side of a `confirmed`
 * outcome (`JobRepository#confirmSlot`, retried on 409 + invariant-asserted —
 * see `job.remote.ts`).
 *
 * CouchDB has no cross-document transactions, so a `confirmed` outcome is two
 * separate writes (the application doc, then the job's quota). Every method
 * here writes the application doc first — the *easy* side to compensate (one
 * more `put`) — and only then consumes the job slot; if the slot consumption
 * fails, the application write is reverted. The reverse order would leave a
 * consumed job slot with no domain-level way to give it back (`quota.ts` only
 * exposes forward transitions), so it is deliberately avoided.
 */
/** Job statuses that still accept new applications (CR-094 FR-VOL-09.3). */
const ACCEPTING_APPLICATION_STATUSES: ReadonlySet<string> = new Set(['open']);

export class JobApplicationRemoteRepository implements JobApplicationRepository {
	private readonly repo: Repository;

	constructor(private readonly dbName: string) {
		this.repo = createRemoteRepository(dbName);
	}

	/**
	 * Validate before every write — `createRemoteRepository.put` validates
	 * nothing, so without this an invalid document shape persists and is then
	 * trusted on read by the rest of the slice.
	 */
	private save(doc: JobApplication): Promise<JobApplication> {
		return this.repo.put(jobApplicationSchema.parse(doc) as JobApplication);
	}

	async list(filter?: JobApplicationFilter): Promise<JobApplication[]> {
		let all = await this.repo.allByType('job_application', isJobApplication);
		if (filter?.jobId) all = all.filter((a) => a.job_id === filter.jobId);
		if (filter?.status) all = all.filter((a) => a.status === filter.status);
		if (filter?.volunteerId) all = all.filter((a) => a.volunteer_id === filter.volunteerId);
		return all;
	}

	async get(id: string): Promise<JobApplication | null> {
		const doc = await this.repo.get<JobApplication>(id);
		if (doc === null) return null;
		return isJobApplication(doc) ? doc : null;
	}

	async getByTrackingToken(token: string): Promise<JobApplication | null> {
		const docs = await this.repo.find<JobApplication>({
			selector: { type: 'job_application', tracking_token: token },
			limit: 1
		});
		return docs.filter(isJobApplication)[0] ?? null;
	}

	async create(
		input: JobApplicationInput,
		ctx: AuthorContext,
		options?: { controlledSkills?: readonly string[] }
	): Promise<JobApplication> {
		const job = await jobRepository().get(input.job_id);
		if (!job) throw new Error(`ไม่พบงาน: ${input.job_id}`);
		// A job that is not published is not taking applications — `draft`,
		// `paused`, `full`, `closed` and `cancelled` must not consume a slot or
		// mint a ticket (CR-094 FR-VOL-09.3 statuses / FR-VOL-13.2).
		if (!ACCEPTING_APPLICATION_STATUSES.has(job.status)) {
			throw new Error(`งานนี้ไม่เปิดรับสมัครแล้ว (สถานะ: ${job.status})`);
		}
		const status = initialStatusForSkills(input.applicant.skills, job, options?.controlledSkills);
		const saved = await this.save(makeJobApplication(input, ctx, status));

		if (status === 'confirmed') {
			try {
				await jobRepository().confirmSlot(input.job_id);
			} catch (err) {
				// The job had no slot to give (QuotaError) or the retry budget was
				// exhausted (409) — the application never actually landed a slot,
				// so remove it rather than leave a `confirmed` doc that lied.
				await this.repo.remove(saved).catch(() => {
					/* best-effort; original error still surfaces below */
				});
				throw err;
			}
		}

		return saved;
	}

	async review(
		id: string,
		decision: Extract<JobApplicationStatus, 'confirmed' | 'rejected'>,
		actor: string,
		notes?: string | null
	): Promise<JobApplication> {
		const latest = await this.repo.get<JobApplication>(id);
		if (!latest) throw new Error(`ไม่พบใบสมัคร: ${id}`);
		if (!canTransitionJobApplication(latest.status, decision)) {
			throw new Error(`ใบสมัคร ${id} ถูกพิจารณาไปแล้ว (สถานะปัจจุบัน: ${latest.status})`);
		}

		const saved = await this.save(
			touch({
				...latest,
				status: decision,
				reviewed_at: new Date().toISOString(),
				reviewed_by: actor,
				review_notes: notes ?? null
			})
		);

		if (decision === 'confirmed') {
			// A pending application never held a job slot (schema.md §2.17
			// migration note) — confirming it is the moment the slot is consumed.
			try {
				await jobRepository().confirmSlot(saved.job_id);
			} catch (err) {
				await this.repo
					.put(
						touch({
							...saved,
							status: 'pending_review' as const,
							reviewed_at: null,
							reviewed_by: null,
							review_notes: null
						})
					)
					.catch(() => {
						/* best-effort; original error still surfaces below */
					});
				throw err;
			}
		}

		return saved;
	}

	async cancel(id: string, actor: string): Promise<JobApplication> {
		const latest = await this.repo.get<JobApplication>(id);
		if (!latest) throw new Error(`ไม่พบใบสมัคร: ${id}`);
		if (!canTransitionJobApplication(latest.status, 'cancelled')) {
			throw new Error(`ใบสมัคร ${id} ยกเลิกไม่ได้แล้ว (สถานะปัจจุบัน: ${latest.status})`);
		}
		return this.save(
			touch({
				...latest,
				status: 'cancelled' as const,
				reviewed_at: new Date().toISOString(),
				reviewed_by: actor
			})
		);
	}
}

let singleton: JobApplicationRepository | null = null;
let singletonDbName: string | null = null;

export function jobApplicationRepository(): JobApplicationRepository {
	const currentDb = getShelterDb();
	if (!singleton || singletonDbName !== currentDb) {
		singleton = new JobApplicationRemoteRepository(currentDb);
		singletonDbName = currentDb;
	}
	return singleton;
}

/** Test-only constructor that bypasses the `getShelterDb()` singleton. */
export function createJobApplicationRepositoryForTest(
	dbName: string
): JobApplicationRemoteRepository {
	return new JobApplicationRemoteRepository(dbName);
}
