import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { getShelterDb } from '$lib/db/shelter';
import { touch, type AuthorContext } from '$lib/db/model';
import { sha256Hex } from '$lib/db/hash';
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
import { shiftDutyWindow } from '../domain/duty-window';
import { shiftKindFor } from '../domain/assign-roster';
import { jobRepository } from './job.remote';
import { shiftAssignmentRepository } from './shift-assignment.remote';
import type { ShiftAssignment, ShiftAssignmentInput } from '../domain/shift-assignment.schema';
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

	/**
	 * A confirmed application is also a roster booking.  The job application
	 * and the shift roster are separate CouchDB documents, so keep the bridge
	 * in one place instead of making each UI remember to create an assignment.
	 *
	 * Older applications may not carry `shift_id`; when their snapshot still
	 * identifies exactly one concrete job shift, resolve it by date/time.  If a
	 * legacy row cannot be mapped safely, return null and let the old flat-job
	 * quota path handle it rather than guessing a shift.
	 */
	private async assignmentFor(application: JobApplication): Promise<ShiftAssignmentInput | null> {
		if (!application.volunteer_id) return null;
		const job = await jobRepository().get(application.job_id);
		if (!job) throw new Error(`ไม่พบงาน: ${application.job_id}`);

		const requestedShiftId = application.shift_id ?? application.selected_shift.shift_id;
		const matches = requestedShiftId
			? job.shifts.filter((shift) => shift.id === requestedShiftId)
			: job.shifts.filter(
					(shift) =>
						shift.date === application.selected_shift.date &&
						shift.start_time === application.selected_shift.start_time &&
						shift.end_time === application.selected_shift.end_time
				);
		if (matches.length !== 1) return null;

		const shift = matches[0];
		return {
			job_id: job._id,
			shift_id: shift.id,
			volunteer_id: application.volunteer_id,
			date: shift.date,
			shift: shiftKindFor(shift),
			station: job.title,
			duty_window: shiftDutyWindow(shift)
		};
	}

	private async assignConfirmed(
		application: JobApplication,
		actor: string
	): Promise<ShiftAssignment | null> {
		const input = await this.assignmentFor(application);
		if (!input) return null;
		return shiftAssignmentRepository().assign(input, {
			shelterCode: application.shelter_code,
			createdBy: actor
		});
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
			selector: {
				type: 'job_application',
				$or: [{ tracking_token_hash: await sha256Hex(token) }, { tracking_token: token }]
			},
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
				const assignment = await this.assignConfirmed(saved, ctx.createdBy);
				if (!assignment) await jobRepository().confirmSlot(input.job_id);
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

		if (decision === 'confirmed') {
			/**
			 * Concrete applications must enter the shift roster before the
			 * application is marked confirmed.  This prevents a confirmed row from
			 * consuming capacity while the shift detail still has no person.  The
			 * assignment repository also performs the single quota transition.
			 */
			let assignment: ShiftAssignment | null = null;
			let saved: JobApplication | null = null;
			try {
				assignment = await this.assignConfirmed(latest, actor);
				saved = await this.save(
					touch({
						...latest,
						status: decision,
						reviewed_at: new Date().toISOString(),
						reviewed_by: actor,
						review_notes: notes ?? null
					})
				);
				if (!assignment) await jobRepository().confirmSlot(saved.job_id);
				return saved;
			} catch (err) {
				if (assignment)
					await shiftAssignmentRepository()
						.unassign(assignment._id)
						.catch(() => undefined);
				if (!assignment && saved) {
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
						.catch(() => undefined);
				}
				throw err;
			}
		}

		return this.save(
			touch({
				...latest,
				status: decision,
				reviewed_at: new Date().toISOString(),
				reviewed_by: actor,
				review_notes: notes ?? null
			})
		);
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
