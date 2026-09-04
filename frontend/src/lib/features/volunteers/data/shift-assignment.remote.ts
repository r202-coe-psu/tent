import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { getShelterDb } from '$lib/db/shelter';
import { touch, type AuthorContext } from '$lib/db/model';
import { sameDutyWindow } from '../domain/duty-window';
import {
	isShiftAssignment,
	shiftAssignmentSchema,
	makeShiftAssignment,
	type CheckInMethod,
	type ShiftAssignment,
	type ShiftAssignmentInput
} from '../domain/shift-assignment.schema';
import { jobRepository } from './job.remote';
import { volunteerRepository } from './volunteer.remote';
import type { ShiftAssignmentFilter, ShiftAssignmentRepository } from './volunteer.repository';

/**
 * Remote CouchDB repository for the volunteers feature (`shift_assignment` doc
 * type — the SM-initiated "dispatch an existing volunteer to a job" flow,
 * distinct from the job-board self-apply flow in `job-application.remote.ts`).
 *
 * `dispatch`/`acceptDispatch`/`declineDispatch` each write the
 * `shift_assignment` doc first (the easy side to compensate — a single `put`)
 * and only then mutate the job's quota (`jobRepository()`, retried on 409 +
 * invariant-asserted — see `job.remote.ts`); if the quota mutation fails, the
 * assignment write is reverted. See `job-application.remote.ts` for why this
 * order is deliberate (no inverse quota transition exists to "give back" a
 * consumed slot).
 */
export class ShiftAssignmentRemoteRepository implements ShiftAssignmentRepository {
	private readonly repo: Repository;

	constructor(private readonly dbName: string) {
		this.repo = createRemoteRepository(dbName);
	}

	/**
	 * Validate before every write — `createRemoteRepository.put` validates
	 * nothing, so without this an invalid document shape persists and is then
	 * trusted on read by the rest of the slice.
	 */
	private save(doc: ShiftAssignment): Promise<ShiftAssignment> {
		return this.repo.put(shiftAssignmentSchema.parse(doc) as ShiftAssignment);
	}

	/** A shift assignment must point at a real child row of its parent job. */
	private async assertShiftReference(input: ShiftAssignmentInput): Promise<void> {
		const job = await jobRepository().get(input.job_id);
		if (!job) throw new Error(`ไม่พบงาน: ${input.job_id}`);
		if (!job.shifts.some((shift) => shift.id === input.shift_id)) {
			throw new Error(`ไม่พบกะ ${input.shift_id} ในงาน ${input.job_id}`);
		}
	}

	/**
	 * Prevent the same volunteer from occupying the same concrete shift twice.
	 * Legacy rows written before `shift_id` existed on this schema carry no
	 * `shift_id` at all, so `a.shift_id === input.shift_id` never matches them —
	 * fall back to comparing `duty_window` for those rows, same as
	 * `capacity.ts`/`shift-roster.ts` do on read.
	 */
	private async assertNoDuplicate(input: ShiftAssignmentInput): Promise<void> {
		const existing = await this.list({ jobId: input.job_id });
		if (
			existing.some(
				(a) =>
					a.volunteer_id === input.volunteer_id &&
					a.status !== 'cancelled' &&
					a.status !== 'no_show' &&
					(a.shift_id
						? a.shift_id === input.shift_id
						: sameDutyWindow(a.duty_window, input.duty_window))
			)
		) {
			throw new Error('อาสาสมัครคนนี้ถูกมอบหมายในกะนี้แล้ว');
		}
	}

	async list(filter?: ShiftAssignmentFilter): Promise<ShiftAssignment[]> {
		let all = await this.repo.allByType('shift_assignment', isShiftAssignment);
		if (filter?.volunteerId) all = all.filter((a) => a.volunteer_id === filter.volunteerId);
		if (filter?.jobId) all = all.filter((a) => a.job_id === filter.jobId);
		if (filter?.date) all = all.filter((a) => a.date === filter.date);
		if (filter?.shift) all = all.filter((a) => a.shift === filter.shift);
		if (filter?.status) all = all.filter((a) => a.status === filter.status);
		if (filter?.dutyWindowStart) {
			all = all.filter((a) => a.duty_window.start_ts >= filter.dutyWindowStart!);
		}
		if (filter?.dutyWindowEnd) {
			all = all.filter((a) => a.duty_window.end_ts <= filter.dutyWindowEnd!);
		}
		return all;
	}

	async get(id: string): Promise<ShiftAssignment | null> {
		const doc = await this.repo.get<ShiftAssignment>(id);
		if (doc === null) return null;
		return isShiftAssignment(doc) ? doc : null;
	}

	async dispatch(input: ShiftAssignmentInput, ctx: AuthorContext): Promise<ShiftAssignment> {
		await this.assertShiftReference(input);
		await this.assertNoDuplicate(input);
		const doc = makeShiftAssignment(input, ctx, {
			status: input.shift === 'flex' ? 'standby' : 'assigned',
			dispatch_status: 'dispatched'
		});
		const saved = await this.save(doc);
		try {
			await jobRepository().dispatch(input.job_id);
		} catch (err) {
			await this.repo.remove(saved).catch(() => {
				/* best-effort; original error still surfaces below */
			});
			throw err;
		}
		return saved;
	}

	/**
	 * Direct assignment — the back-office roster screen's only write path
	 * (owner decision 2026-08-29: "ไม่มีการรออนุมัติ ให้ assign ให้เลย").
	 *
	 * Same write order and compensation as {@link dispatch}: the assignment doc
	 * first, then the quota move. The difference is only which quota transition
	 * runs — `confirmSlot` (remaining → confirmed) instead of `dispatch`
	 * (remaining → dispatched) — so `slots_dispatched` stays 0 for work booked
	 * this way and the shift's 3-colour bar shows it as filled immediately.
	 */
	async assign(input: ShiftAssignmentInput, ctx: AuthorContext): Promise<ShiftAssignment> {
		await this.assertShiftReference(input);
		await this.assertNoDuplicate(input);
		const doc = makeShiftAssignment(input, ctx, {
			status: 'standby',
			dispatch_status: 'accepted'
		});
		const saved = await this.save(doc);
		try {
			await jobRepository().confirmSlot(input.job_id);
		} catch (err) {
			await this.repo.remove(saved).catch(() => {
				/* best-effort; original error still surfaces below */
			});
			throw err;
		}
		return saved;
	}

	async acceptDispatch(id: string): Promise<ShiftAssignment> {
		const latest = await this.getDispatched(id);
		const saved = await this.save(touch({ ...latest, dispatch_status: 'accepted' as const }));
		try {
			await jobRepository().acceptDispatch(saved.job_id);
		} catch (err) {
			await this.save(touch({ ...saved, dispatch_status: 'dispatched' as const })).catch(() => {
				/* best-effort; original error still surfaces below */
			});
			throw err;
		}
		return saved;
	}

	async declineDispatch(id: string): Promise<ShiftAssignment> {
		const latest = await this.getDispatched(id);
		const saved = await this.save(
			touch({ ...latest, dispatch_status: 'declined' as const, status: 'cancelled' as const })
		);
		try {
			await jobRepository().declineDispatch(saved.job_id);
		} catch (err) {
			await this.save(
				touch({ ...saved, dispatch_status: 'dispatched' as const, status: latest.status })
			).catch(() => {
				/* best-effort; original error still surfaces below */
			});
			throw err;
		}
		return saved;
	}

	private async getDispatched(id: string): Promise<ShiftAssignment> {
		const latest = await this.repo.get<ShiftAssignment>(id);
		if (!latest) throw new Error(`ไม่พบตารางเข้าเวร: ${id}`);
		if (latest.dispatch_status !== 'dispatched') {
			throw new Error(
				`ตารางเข้าเวร ${id} ไม่ได้อยู่ในสถานะรอตอบรับ (dispatch_status ปัจจุบัน: ${latest.dispatch_status ?? 'null'})`
			);
		}
		return latest;
	}

	async checkIn(
		id: string,
		actor: string,
		method: CheckInMethod = 'qr',
		reason?: string | null
	): Promise<ShiftAssignment> {
		const latest = await this.repo.get<ShiftAssignment>(id);
		if (!latest) throw new Error(`ไม่พบตารางเข้าเวร: ${id}`);
		if (method === 'manual_override' && !reason) {
			throw new Error('กรุณาระบุเหตุผลเมื่อเช็คอินแทน (Manual Override)');
		}
		const saved = await this.save(
			touch({
				...latest,
				status: 'checked_in' as const,
				check_in_at: new Date().toISOString(),
				check_in_by: actor,
				check_in_method: method,
				check_in_reason: method === 'manual_override' ? (reason ?? null) : null
			})
		);
		await volunteerRepository().setCheckedIn(saved.volunteer_id, true, saved.shelter_code);
		return saved;
	}

	async checkOut(id: string): Promise<ShiftAssignment> {
		const latest = await this.repo.get<ShiftAssignment>(id);
		if (!latest) throw new Error(`ไม่พบตารางเข้าเวร: ${id}`);
		const saved = await this.save(
			touch({ ...latest, status: 'completed' as const, check_out_at: new Date().toISOString() })
		);
		await volunteerRepository().setCheckedIn(saved.volunteer_id, false, null);
		return saved;
	}

	/**
	 * SM removes a volunteer from a shift — the job detail shifts tab's
	 * "ลบออกจากกะ". See the interface doc (`volunteer.repository.ts`) for why
	 * an outstanding offer and an outright assignment take different quota
	 * paths.
	 *
	 * Same write order and compensation as every other mutation here: the
	 * assignment doc is set to `cancelled` first, and only then is the job's
	 * quota given back; if that fails, the doc is reverted to its prior state.
	 */
	async unassign(id: string): Promise<ShiftAssignment> {
		const latest = await this.repo.get<ShiftAssignment>(id);
		if (!latest) throw new Error(`ไม่พบตารางเข้าเวร: ${id}`);
		if (latest.status === 'checked_in' || latest.status === 'completed') {
			throw new Error(
				`ถอดอาสาออกจากกะนี้ไม่ได้ — เช็คอินไปแล้ว (สถานะ: ${latest.status}) กรุณาเช็คเอาต์แทน`
			);
		}
		if (latest.status === 'cancelled' || latest.status === 'no_show') {
			throw new Error(`ตารางเข้าเวรนี้ถูกยกเลิกไปแล้ว (สถานะ: ${latest.status})`);
		}

		// An unanswered offer never touched `slots_confirmed` — removing it is
		// exactly what declining already does, so reuse that transition rather
		// than duplicate it.
		if (latest.dispatch_status === 'dispatched') {
			return this.declineDispatch(id);
		}

		const saved = await this.save(touch({ ...latest, status: 'cancelled' as const }));
		try {
			await jobRepository().releaseSlot(saved.job_id);
		} catch (err) {
			await this.save(touch({ ...saved, status: latest.status })).catch(() => {
				/* best-effort; original error still surfaces below */
			});
			throw err;
		}
		return saved;
	}
}

let singleton: ShiftAssignmentRepository | null = null;
let singletonDbName: string | null = null;

export function shiftAssignmentRepository(): ShiftAssignmentRepository {
	const currentDb = getShelterDb();
	if (!singleton || singletonDbName !== currentDb) {
		singleton = new ShiftAssignmentRemoteRepository(currentDb);
		singletonDbName = currentDb;
	}
	return singleton;
}

/** Test-only constructor that bypasses the `getShelterDb()` singleton. */
export function createShiftAssignmentRepositoryForTest(
	dbName: string
): ShiftAssignmentRemoteRepository {
	return new ShiftAssignmentRemoteRepository(dbName);
}
