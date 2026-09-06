import { sha256Hex } from '$lib/db/hash';
import { ulid } from '$lib/db/ulid';
import { nextVolunteerCode } from '../domain/volunteer-code';
import { DEFAULT_CONTROLLED_SKILLS } from '../domain/skills';
import type { VolunteerApplyInput } from '$lib/features/volunteer-portal/domain/volunteer';
import {
	findAsPublicWriter,
	getAsPublicWriter,
	putAsPublicWriter,
	rollbackAsPublicWriter
} from '$lib/server/couch-public-writer';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { adminRaw } from '$lib/server/couch-admin';
import { readEffectiveMasterDoc } from '$lib/server/master-data-server';
import {
	makeShiftAssignment,
	shiftAssignmentSchema,
	type ShiftAssignmentInput,
	type ShiftAssignment
} from '../domain/shift-assignment.schema';
import { shiftDutyWindow } from '../domain/duty-window';
import { shiftKindFor } from '../domain/assign-roster';
import { defaultShiftEndDate } from '../domain/shift-batch';

const MAX_QUOTA_RETRIES = 5;

type CouchJob = {
	_id: string;
	_rev?: string;
	type: 'job';
	schema_v: number;
	shelter_code: string;
	title: string;
	status: string;
	updated_at?: string;
	tier: string;
	auto_accept?: boolean;
	quota: number;
	slots_confirmed: number;
	slots_dispatched: number;
	slots_remaining: number;
	shifts?: CouchJobShift[];
};

type CouchJobShift = {
	id?: string;
	shift_id?: string;
	date?: string;
	end_date?: string;
	start_time?: string;
	end_time?: string;
	station?: string | null;
	quota?: number;
	slots_confirmed?: number;
	slots_dispatched?: number;
	slots_remaining?: number;
};

type CouchVolunteer = {
	_id: string;
	_rev?: string;
	phone_hash?: string;
	first_name?: string;
	last_name?: string;
	skills?: string[];
	tracking_token_hash?: string;
	[key: string]: unknown;
};

type DirectApplicationInput = Omit<VolunteerApplyInput, 'captchaToken'> & {
	shelter_code?: string;
	start_time?: string;
	end_time?: string;
};

export class PublicApplicationError extends Error {
	constructor(
		readonly code:
			| 'JOB_NOT_FOUND'
			| 'JOB_NOT_OPEN'
			| 'JOB_FULL'
			| 'SHIFT_NOT_FOUND'
			| 'SHIFT_FULL'
			| 'SHIFT_ID_REQUIRED'
			| 'SHIFT_DATE_AMBIGUOUS'
			| 'DUPLICATE_APPLICATION'
			| 'TIME_CONFLICT'
			| 'JOB_NOT_READY'
			| 'WRITE_FAILED',
		readonly httpStatus: number = 409
	) {
		super(code);
		this.name = 'PublicApplicationError';
	}
}

function normalizedJobId(value: string): string {
	return value.startsWith('job:') ? value : `job:${value}`;
}

function docsFrom(data: unknown): Record<string, unknown>[] {
	if (!data || typeof data !== 'object' || !Array.isArray((data as { docs?: unknown }).docs)) {
		return [];
	}
	return (data as { docs: unknown[] }).docs.filter(
		(doc): doc is Record<string, unknown> => Boolean(doc) && typeof doc === 'object'
	);
}

async function findShelterCodeForJob(jobId: string, preferred?: string): Promise<string | null> {
	if (preferred) return preferred.toUpperCase();
	const registry = await adminRaw('/registry/_all_docs?include_docs=true', 'GET');
	const rows = (registry.data as { rows?: { doc?: { type?: string; code?: string } }[] } | null)
		?.rows;
	for (const row of rows ?? []) {
		const code = row.doc?.type === 'shelter' ? row.doc.code : undefined;
		if (!code) continue;
		const found = await getAsPublicWriter(shelterDbName(code), jobId);
		if (found.status === 200) return code.toUpperCase();
	}
	return null;
}

export function selectedShift(job: CouchJob, input: DirectApplicationInput): CouchJobShift | null {
	const shifts = job.shifts ?? [];
	if (shifts.length === 0) return null;
	if (input.shift_id) {
		const found = shifts.find((shift) => (shift.shift_id || shift.id) === input.shift_id);
		if (!found) throw new PublicApplicationError('SHIFT_NOT_FOUND', 422);
		return found;
	}
	if (input.shift_date) {
		const candidates = shifts.filter((shift) => shift.date === input.shift_date);
		if (candidates.length === 1) return candidates[0];
		if (candidates.length > 1) {
			if (input.start_time) {
				const timeMatch = candidates.find(
					(shift) =>
						shift.start_time === input.start_time &&
						(!input.end_time || shift.end_time === input.end_time)
				);
				if (timeMatch) return timeMatch;
			}
			throw new PublicApplicationError('SHIFT_DATE_AMBIGUOUS', 422);
		}
		throw new PublicApplicationError('SHIFT_NOT_FOUND', 422);
	}
	if (shifts.length === 1) {
		return shifts[0];
	}
	throw new PublicApplicationError('SHIFT_ID_REQUIRED', 422);
}

async function controlledSkills(shelterCode: string): Promise<Set<string>> {
	const values = new Set(DEFAULT_CONTROLLED_SKILLS.map((value) => value.trim().toLowerCase()));
	try {
		const master = await readEffectiveMasterDoc('volunteer_skills', shelterCode);
		for (const item of master?.items ?? []) {
			if (item.category === 'controlled' && item.status !== 'inactive') {
				values.add(item.code.trim().toLowerCase());
				values.add(item.label.trim().toLowerCase());
			}
		}
	} catch {
		// The built-in controlled-skill floor still keeps medical work pending review.
	}
	return values;
}

function needsReview(job: CouchJob, skills: string[], controlled: Set<string>): boolean {
	return (
		job.tier === 'staff-capable' ||
		skills.some((skill) => controlled.has(skill.trim().toLowerCase())) ||
		job.auto_accept !== true
	);
}

function shiftId(shift: CouchJobShift | null): string | undefined {
	return shift ? shift.shift_id || shift.id : undefined;
}

/** Convert the verified CouchDB row into the domain shape used by roster writes. */
function concreteShift(shift: CouchJobShift | null) {
	if (
		!shift ||
		typeof shift.date !== 'string' ||
		typeof shift.start_time !== 'string' ||
		typeof shift.end_time !== 'string'
	)
		return null;
	const sId = shiftId(shift) || `shift-${shift.date}-${shift.start_time.replace(':', '')}`;
	return {
		id: sId,
		date: shift.date,
		end_date: shift.end_date ?? defaultShiftEndDate(shift.date, shift.start_time, shift.end_time),
		start_time: shift.start_time,
		end_time: shift.end_time,
		quota: quotaOf(shift)
	};
}

/** Build the roster row for an auto-confirmed public application. */
function makeConfirmedAssignment(
	job: CouchJob,
	selected: CouchJobShift | null,
	volunteerId: string,
	shelterCode: string,
	now: string
): ShiftAssignment | null {
	const shift = concreteShift(selected);
	if (!shift) return null;
	const input: ShiftAssignmentInput = {
		job_id: job._id,
		shift_id: shift.id,
		volunteer_id: volunteerId,
		date: shift.date,
		shift: shiftKindFor(shift),
		station: selected?.station?.trim() || job.title,
		duty_window: shiftDutyWindow(shift)
	};
	const assignment = makeShiftAssignment(
		input,
		{ shelterCode, createdBy: 'public' },
		{ status: 'standby', dispatch_status: 'accepted' }
	);
	return shiftAssignmentSchema.parse({
		...assignment,
		created_at: now,
		updated_at: now
	}) as ShiftAssignment;
}

function quotaOf(shift: CouchJobShift): number {
	return Number.isInteger(shift.quota) && (shift.quota ?? 0) > 0 ? shift.quota! : 0;
}

async function reserveSlot(
	dbName: string,
	jobId: string,
	selected: CouchJobShift | null
): Promise<void> {
	for (let attempt = 0; attempt < MAX_QUOTA_RETRIES; attempt++) {
		const currentRes = await getAsPublicWriter(dbName, jobId);
		if (currentRes.status === 404) throw new PublicApplicationError('JOB_NOT_FOUND', 404);
		if (currentRes.status >= 400 || !currentRes.data)
			throw new PublicApplicationError('JOB_NOT_READY', 409);
		const current = currentRes.data as CouchJob;
		if (current.status !== 'open') throw new PublicApplicationError('JOB_NOT_OPEN', 409);

		const next = structuredClone(current) as CouchJob;
		if (selected) {
			const wanted = shiftId(selected);
			const live = next.shifts?.find((shift) =>
				wanted
					? (shift.shift_id || shift.id) === wanted
					: shift.date === selected.date && shift.start_time === selected.start_time
			);
			if (!live) throw new PublicApplicationError('SHIFT_NOT_FOUND', 422);
			const quota = quotaOf(live);
			const confirmed = live.slots_confirmed ?? 0;
			const dispatched = live.slots_dispatched ?? 0;
			const remaining = live.slots_remaining ?? quota - confirmed - dispatched;
			if (remaining <= 0) throw new PublicApplicationError('SHIFT_FULL', 409);
			live.slots_confirmed = confirmed + 1;
			live.slots_remaining = remaining - 1;
			next.slots_confirmed = (next.slots_confirmed ?? 0) + 1;
			next.slots_remaining = Math.max((next.slots_remaining ?? 0) - 1, 0);
		} else {
			if ((next.slots_remaining ?? 0) <= 0) throw new PublicApplicationError('JOB_FULL', 409);
			next.slots_confirmed = (next.slots_confirmed ?? 0) + 1;
			next.slots_remaining = (next.slots_remaining ?? 0) - 1;
		}
		next.status = next.slots_remaining <= 0 ? 'full' : 'open';
		next.updated_at = new Date().toISOString();
		const put = await putAsPublicWriter(dbName, jobId, next);
		if (put.status === 409) continue;
		if (put.status >= 400) throw new PublicApplicationError('WRITE_FAILED', 502);
		return;
	}
	throw new PublicApplicationError('WRITE_FAILED', 409);
}

async function releaseSlot(
	dbName: string,
	jobId: string,
	selected: CouchJobShift | null
): Promise<void> {
	for (let attempt = 0; attempt < MAX_QUOTA_RETRIES; attempt++) {
		const currentRes = await getAsPublicWriter(dbName, jobId);
		if (currentRes.status !== 200 || !currentRes.data) return;
		const current = currentRes.data as CouchJob;
		const next = structuredClone(current) as CouchJob;
		if (selected) {
			const wanted = shiftId(selected);
			const live = next.shifts?.find((shift) =>
				wanted
					? (shift.shift_id || shift.id) === wanted
					: shift.date === selected.date && shift.start_time === selected.start_time
			);
			if (!live || (live.slots_confirmed ?? 0) <= 0) return;
			live.slots_confirmed = (live.slots_confirmed ?? 0) - 1;
			live.slots_remaining = (live.slots_remaining ?? 0) + 1;
		}
		next.slots_confirmed = Math.max((next.slots_confirmed ?? 0) - 1, 0);
		next.slots_remaining = (next.slots_remaining ?? 0) + 1;
		next.status = 'open';
		next.updated_at = new Date().toISOString();
		const put = await putAsPublicWriter(dbName, jobId, next);
		if (put.status === 409) continue;
		return;
	}
}

export async function applyPublicVolunteerApplication(
	jobIdInput: string,
	input: DirectApplicationInput
): Promise<{ tracking_token: string; status: string; job_id: string; shift_id?: string }> {
	const jobId = normalizedJobId(jobIdInput);
	const shelterCode = await findShelterCodeForJob(jobId, input.shelter_code);
	if (!shelterCode) throw new PublicApplicationError('JOB_NOT_FOUND', 404);
	const dbName = shelterDbName(shelterCode);
	const jobRes = await getAsPublicWriter(dbName, jobId);
	if (jobRes.status === 404) throw new PublicApplicationError('JOB_NOT_FOUND', 404);
	if (jobRes.status >= 400 || !jobRes.data) throw new PublicApplicationError('JOB_NOT_READY', 409);
	const job = jobRes.data as CouchJob;
	if (job.type !== 'job' || job.shelter_code.toUpperCase() !== shelterCode) {
		throw new PublicApplicationError('JOB_NOT_FOUND', 404);
	}
	if (job.status !== 'open') throw new PublicApplicationError('JOB_NOT_OPEN', 409);

	const selected = selectedShift(job, input);
	const verifiedShiftId = shiftId(selected);
	const skills = [...new Set(input.skills.map((skill) => skill.trim()).filter(Boolean))];
	const controlled = await controlledSkills(shelterCode);
	const status = needsReview(job, skills, controlled) ? 'pending_review' : 'confirmed';
	const phoneHash = await sha256Hex(input.phone);
	const duplicate = await findAsPublicWriter(
		dbName,
		{
			type: 'job_application',
			job_id: jobId,
			'applicant.phone_hash': phoneHash,
			status: { $ne: 'cancelled' }
		},
		{ limit: 1 }
	);
	if (docsFrom(duplicate.data).length > 0) {
		throw new PublicApplicationError('DUPLICATE_APPLICATION', 409);
	}

	const volunteersRes = await findAsPublicWriter(
		dbName,
		{ type: 'volunteer', phone_hash: phoneHash },
		{ limit: 1 }
	);
	const existing = docsFrom(volunteersRes.data)[0] as CouchVolunteer | undefined;
	const volunteerId = existing?._id ?? `volunteer:${ulid().toLowerCase()}`;
	const now = new Date().toISOString();
	const trackingToken = `TKT-VOL-${ulid().slice(-16)}`;
	const trackingTokenHash = await sha256Hex(trackingToken);
	const codesRes = await findAsPublicWriter(
		dbName,
		{ type: 'volunteer' },
		{ limit: 5000, fields: ['volunteer_code'] }
	);
	const existingCodes = docsFrom(codesRes.data)
		.map((doc) => doc.volunteer_code)
		.filter((code): code is string => typeof code === 'string');
	const volunteer = existing
		? {
				...existing,
				phone_hash: phoneHash,
				skills: [...new Set([...(existing.skills ?? []), ...skills])],
				tracking_token_hash: trackingTokenHash,
				updated_at: now,
				updated_by: 'public'
			}
		: {
				_id: volunteerId,
				type: 'volunteer',
				schema_v: 3,
				shelter_code: shelterCode,
				created_at: now,
				updated_at: now,
				created_by: 'public',
				first_name: input.first_name,
				last_name: input.last_name,
				phone: input.phone,
				phone_hash: phoneHash,
				national_id: input.national_id || null,
				national_id_hash: input.national_id ? await sha256Hex(input.national_id) : null,
				email: input.email || null,
				skills,
				tracking_token_hash: trackingTokenHash,
				status: 'active',
				checked_in: false,
				current_shelter_code: null,
				volunteer_code: nextVolunteerCode(existingCodes),
				identity_verified: false,
				source: 'public_apply',
				personnel_type: 'volunteer'
			};

	if (status === 'confirmed') await reserveSlot(dbName, jobId, selected);
	const applicationId = `job_application:${ulid().toLowerCase()}`;
	const application = {
		_id: applicationId,
		type: 'job_application',
		schema_v: 3,
		shelter_code: shelterCode,
		created_at: now,
		updated_at: now,
		created_by: 'public',
		job_id: jobId,
		shift_id: verifiedShiftId,
		volunteer_id: volunteerId,
		applicant: {
			first_name: input.first_name,
			last_name: input.last_name,
			phone: input.phone,
			phone_hash: phoneHash,
			national_id: input.national_id || null,
			national_id_hash: input.national_id ? await sha256Hex(input.national_id) : null,
			email: input.email || null,
			skills
		},
		selected_shift: {
			shift_id: verifiedShiftId,
			date: selected?.date || input.shift_date || '',
			start_time: selected?.start_time || '',
			end_time: selected?.end_time || '',
			station: selected?.station || input.station || null
		},
		tracking_token_hash: trackingTokenHash,
		status,
		review_notes: null,
		reviewed_at: null,
		reviewed_by: null,
		source: 'public'
	};

	const assignment =
		status === 'confirmed'
			? makeConfirmedAssignment(job, selected, volunteerId, shelterCode, now)
			: null;
	const appPut = await putAsPublicWriter(dbName, applicationId, application);
	if (appPut.status < 200 || appPut.status >= 300) {
		if (status === 'confirmed') await releaseSlot(dbName, jobId, selected);
		throw new PublicApplicationError('WRITE_FAILED', 502);
	}
	let assignmentPut: { status: number; data: unknown } | null = null;
	if (assignment) {
		assignmentPut = await putAsPublicWriter(dbName, assignment._id, assignment);
		if (assignmentPut.status < 200 || assignmentPut.status >= 300) {
			const applicationRev = (appPut.data as { rev?: string } | null)?.rev;
			if (applicationRev)
				await rollbackAsPublicWriter(dbName, [{ id: applicationId, rev: applicationRev }]);
			await releaseSlot(dbName, jobId, selected);
			throw new PublicApplicationError('WRITE_FAILED', 502);
		}
	}
	const volunteerPut = await putAsPublicWriter(dbName, volunteerId, volunteer);
	if (volunteerPut.status < 200 || volunteerPut.status >= 300) {
		const applicationRev = (appPut.data as { rev?: string } | null)?.rev;
		const assignmentRev = (assignmentPut?.data as { rev?: string } | null)?.rev;
		await rollbackAsPublicWriter(
			dbName,
			[
				applicationRev ? { id: applicationId, rev: applicationRev } : null,
				assignmentRev && assignment ? { id: assignment._id, rev: assignmentRev } : null
			].filter((row): row is { id: string; rev: string } => row !== null)
		);
		if (status === 'confirmed') await releaseSlot(dbName, jobId, selected);
		throw new PublicApplicationError('WRITE_FAILED', 502);
	}

	return { tracking_token: trackingToken, status, job_id: jobId, shift_id: verifiedShiftId };
}
