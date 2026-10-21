import { randomBytes } from 'node:crypto';
import { sha256Hex } from '$lib/db/hash';
import { ulid } from '$lib/db/ulid';
import { nextVolunteerCode } from '../domain/volunteer-code';
import { normalizePhone } from '../domain/phone';
import { DEFAULT_CONTROLLED_SKILLS } from '../domain/skills';
import { resolveSkillLabel, skillOptionsFromMaster } from '../domain/skill-catalog';
import {
	formatMintedTicketToken,
	TRACKING_TOKEN_RANDOM_BYTES,
	type ApplyShift,
	type VolunteerApplyInput
} from '$lib/features/volunteer-portal/domain/volunteer';
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
import {
	windowsOverlap,
	type BookingWindow
} from '$lib/features/volunteer-portal/domain/booking-overlap';

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
	skills_required?: string[];
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
	volunteer_code?: string;
	identity_verified?: boolean;
	identity_verification?: { status?: string; [key: string]: unknown };
	skill_verifications?: Record<string, { status?: string; [key: string]: unknown }>;
	email?: string;
	[key: string]: unknown;
};

type DirectApplicationInput = Omit<VolunteerApplyInput, 'captchaToken'> & {
	shelter_code?: string;
	start_time?: string;
	end_time?: string;
};

export type PublicApplicationErrorCode = PublicApplicationError['code'];

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
			| 'AMBIGUOUS_VOLUNTEER'
			| 'TIME_CONFLICT'
			| 'JOB_NOT_READY'
			| 'WRITER_UNAVAILABLE'
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

function normalizedSkill(value: string): string {
	return value.trim().normalize('NFC').toLowerCase();
}

function docsFrom(data: unknown): Record<string, unknown>[] {
	if (!data || typeof data !== 'object' || !Array.isArray((data as { docs?: unknown }).docs)) {
		return [];
	}
	return (data as { docs: unknown[] }).docs.filter(
		(doc): doc is Record<string, unknown> => Boolean(doc) && typeof doc === 'object'
	);
}

async function matchingVolunteers(dbName: string, phoneHash: string): Promise<CouchVolunteer[]> {
	const result = await findAsPublicWriter(
		dbName,
		{ type: 'volunteer', phone_hash: phoneHash },
		{ limit: 100 }
	);
	return docsFrom(result.data).filter((doc): doc is CouchVolunteer => typeof doc._id === 'string');
}

function bookingWindowFrom(doc: Record<string, unknown>): BookingWindow | null {
	const dutyWindow = doc.duty_window;
	if (!dutyWindow || typeof dutyWindow !== 'object') return null;
	const startTs = (dutyWindow as { start_ts?: unknown }).start_ts;
	const endTs = (dutyWindow as { end_ts?: unknown }).end_ts;
	return typeof startTs === 'string' && typeof endTs === 'string'
		? { start_ts: startTs, end_ts: endTs }
		: null;
}

async function hasActiveBookingConflict(
	dbName: string,
	volunteerId: string,
	candidate: BookingWindow
): Promise<boolean> {
	const result = await findAsPublicWriter(
		dbName,
		{
			type: 'shift_assignment',
			volunteer_id: volunteerId,
			status: { $in: ['assigned', 'standby', 'checked_in'] }
		},
		{ limit: 100, fields: ['_id', 'duty_window', 'status'] }
	);

	return docsFrom(result.data).some((assignment) => {
		const existing = bookingWindowFrom(assignment);
		return existing ? windowsOverlap(candidate, existing) : true;
	});
}

/**
 * Read the job as the public writer.
 *
 * A 401/403 means CouchDB refused the `public_writer` user itself — missing, wrong
 * password, or not a member of this shelter's database — which is a deployment fault, not
 * a job that is still being set up. It gets its own code and a server log naming the fix,
 * instead of reaching the applicant as "JOB_NOT_READY" and leaving everyone guessing.
 */
async function readJob(dbName: string, jobId: string): Promise<CouchJob> {
	const res = await getAsPublicWriter(dbName, jobId);
	if (res.status === 404) throw new PublicApplicationError('JOB_NOT_FOUND', 404);
	if (res.status === 401 || res.status === 403) {
		console.error(
			`[public-volunteer-apply] CouchDB refused public_writer on ${dbName} (HTTP ${res.status}) — ` +
				'check COUCHDB_PUBLIC_WRITER_URL and run `pnpm redeploy:access --write --confirm`'
		);
		throw new PublicApplicationError('WRITER_UNAVAILABLE', 503);
	}
	if (res.status >= 400 || !res.data) throw new PublicApplicationError('JOB_NOT_READY', 409);
	return res.data as CouchJob;
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
		if (found) return found;
		if (input.shift_date) {
			const timeMatch = shifts.find(
				(shift) =>
					shift.date === input.shift_date &&
					(!input.start_time || shift.start_time === input.start_time)
			);
			if (timeMatch) return timeMatch;
			const dateMatch = shifts.filter((shift) => shift.date === input.shift_date);
			if (dateMatch.length === 1) return dateMatch[0];
		}
		if (shifts.length === 1) return shifts[0];
		throw new PublicApplicationError('SHIFT_NOT_FOUND', 422);
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
				values.add(item.label_th.trim().toLowerCase());
				values.add(item.label_en.trim().toLowerCase());
			}
		}
	} catch {
		// The built-in controlled-skill floor still keeps medical work pending review.
	}
	return values;
}

async function displaySkillLabels(shelterCode: string, values: string[]): Promise<string[]> {
	try {
		const master = await readEffectiveMasterDoc('volunteer_skills', shelterCode);
		const options = skillOptionsFromMaster(master?.items ?? []);
		return values.map((value) => resolveSkillLabel(value, options));
	} catch {
		// If Master Data is unavailable, preserve the stored value instead of hiding it.
		return values;
	}
}

function hasVerifiedSkill(profile: CouchVolunteer | undefined, skill: string): boolean {
	const records = profile?.skill_verifications ?? {};
	const wanted = normalizedSkill(skill);
	const record = Object.entries(records).find(([key]) => normalizedSkill(key) === wanted)?.[1];
	return record?.status === 'verified';
}

function identityStatus(profile: CouchVolunteer | undefined): string {
	return (
		profile?.identity_verification?.status ?? (profile?.identity_verified ? 'verified' : 'pending')
	);
}

function needsReview(
	job: CouchJob,
	skills: string[],
	controlled: Set<string>,
	profile?: CouchVolunteer
): boolean {
	return (
		job.tier === 'staff-capable' ||
		skills.some(
			(skill) => controlled.has(skill.trim().toLowerCase()) && !hasVerifiedSkill(profile, skill)
		) ||
		(Boolean(profile) && identityStatus(profile) !== 'verified') ||
		job.auto_accept !== true
	);
}

function reviewReasons(
	job: CouchJob,
	skills: string[],
	controlled: Set<string>,
	profile?: CouchVolunteer
): string[] {
	const reasons: string[] = [];
	if (
		skills.some(
			(skill) => controlled.has(skill.trim().toLowerCase()) && !hasVerifiedSkill(profile, skill)
		)
	)
		reasons.push('skill_certification');
	if (profile && identityStatus(profile) !== 'verified') reasons.push('identity');
	if (job.tier !== 'operational' || job.auto_accept !== true) reasons.push('job_fit');
	return reasons;
}

function maskedDisplayName(profile: CouchVolunteer): string {
	const first = String(profile.first_name ?? '');
	const last = String(profile.last_name ?? '');
	return `${first.slice(0, 1)}*** ${last.slice(0, 1)}***`.trim();
}

export type PublicApplicationPreflight = {
	match: 'no_match' | 'matched_one' | 'ambiguous_match';
	existing_profile?: {
		volunteer_code: string;
		display_name: string;
		identity_status: string;
		existing_skills: string[];
		new_skills: string[];
		new_controlled_skills: string[];
	};
	message: string;
};

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
		const current = await readJob(dbName, jobId);
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
			if ((next.slots_remaining ?? 0) <= 0) {
				throw new PublicApplicationError('JOB_FULL', 409);
			}
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

export async function preflightPublicVolunteerApplication(
	jobIdInput: string,
	input: DirectApplicationInput
): Promise<PublicApplicationPreflight> {
	const jobId = normalizedJobId(jobIdInput);
	const shelterCode = await findShelterCodeForJob(jobId, input.shelter_code);
	if (!shelterCode) throw new PublicApplicationError('JOB_NOT_FOUND', 404);
	// The same job and shift checks as the apply below, so a closed job or a shift that is
	// gone fails here with its own message rather than after the applicant has confirmed.
	const job = await readJob(shelterDbName(shelterCode), jobId);
	if (job.type !== 'job' || job.shelter_code.toUpperCase() !== shelterCode) {
		throw new PublicApplicationError('JOB_NOT_FOUND', 404);
	}
	if (job.status !== 'open') throw new PublicApplicationError('JOB_NOT_OPEN', 409);
	// A multi-shift request (#716) sends no shift here: each shift is judged at apply time,
	// where one that fails is reported without stopping the others.
	if (input.shift_id || input.shift_date) selectedShift(job, input);
	const hash = await sha256Hex(normalizePhone(input.phone));
	const volunteers = await matchingVolunteers(shelterDbName(shelterCode), hash);
	if (volunteers.length === 0) {
		return { match: 'no_match', message: 'ไม่พบ Volunteer profile เดิม สามารถสมัครใหม่ได้' };
	}
	if (volunteers.length > 1) {
		return {
			match: 'ambiguous_match',
			message: 'พบข้อมูลที่อาจตรงกับมากกว่าหนึ่ง profile กรุณาติดต่อเจ้าหน้าที่'
		};
	}
	const existing = volunteers[0];
	const controlled = await controlledSkills(shelterCode);
	const existingSkills = existing.skills ?? [];
	const newSkills = input.skills
		.map((skill) => skill.trim())
		.filter(
			(skill, index, all) =>
				!existingSkills.some((value) => normalizedSkill(value) === normalizedSkill(skill)) &&
				all.findIndex((value) => normalizedSkill(value) === normalizedSkill(skill)) === index
		);
	const newControlled = newSkills.filter((skill) => controlled.has(normalizedSkill(skill)));
	const allSkillLabels = await displaySkillLabels(shelterCode, [...existingSkills, ...newSkills]);
	const existingSkillLabels = allSkillLabels.slice(0, existingSkills.length);
	const newSkillLabels = allSkillLabels.slice(existingSkills.length);
	const labelsBySkill = new Map(
		newSkills.map((skill, index) => [normalizedSkill(skill), newSkillLabels[index] ?? skill])
	);
	const newControlledSkillLabels = newControlled.map(
		(skill) => labelsBySkill.get(normalizedSkill(skill)) ?? skill
	);
	return {
		match: 'matched_one',
		existing_profile: {
			volunteer_code: existing.volunteer_code ?? '',
			display_name: maskedDisplayName(existing),
			identity_status: identityStatus(existing),
			existing_skills: existingSkillLabels,
			new_skills: newSkillLabels,
			new_controlled_skills: newControlledSkillLabels
		},
		message: 'เบอร์โทรนี้เคยสมัครไว้แล้ว ระบบจะอัปเดต profile เดิมและสร้างใบสมัครใหม่'
	};
}

export async function applyPublicVolunteerApplication(
	jobIdInput: string,
	input: DirectApplicationInput,
	options: {
		/**
		 * Judge review as for an applicant with no profile, even though one exists now. Set by
		 * a multi-shift request from a new phone: its first shift creates the profile, and the
		 * shifts after it must not be held for identity review that the first one was not.
		 */
		reviewAsNewApplicant?: boolean;
	} = {}
): Promise<{
	tracking_token: string;
	status: string;
	job_id: string;
	shift_id?: string;
	volunteer_token?: string;
}> {
	const jobId = normalizedJobId(jobIdInput);
	const shelterCode = await findShelterCodeForJob(jobId, input.shelter_code);
	if (!shelterCode) throw new PublicApplicationError('JOB_NOT_FOUND', 404);
	const dbName = shelterDbName(shelterCode);
	const job = await readJob(dbName, jobId);
	if (job.type !== 'job' || job.shelter_code.toUpperCase() !== shelterCode) {
		throw new PublicApplicationError('JOB_NOT_FOUND', 404);
	}
	if (job.status !== 'open') throw new PublicApplicationError('JOB_NOT_OPEN', 409);

	const selected = selectedShift(job, input);
	const verifiedShiftId = shiftId(selected);
	const skills = [...new Set(input.skills.map((skill) => skill.trim()).filter(Boolean))];

	const controlled = await controlledSkills(shelterCode);
	const phoneHash = await sha256Hex(normalizePhone(input.phone));
	const volunteers = await matchingVolunteers(dbName, phoneHash);
	if (volunteers.length > 1) throw new PublicApplicationError('AMBIGUOUS_VOLUNTEER', 409);
	const existing = volunteers[0];
	const volunteerId = existing?._id ?? `volunteer:${ulid().toLowerCase()}`;
	const reviewProfile = options.reviewAsNewApplicant ? undefined : existing;
	const status = needsReview(job, skills, controlled, reviewProfile)
		? 'pending_review'
		: 'confirmed';
	const selectedShiftId = verifiedShiftId;
	const duplicate = await findAsPublicWriter(
		dbName,
		{
			type: 'job_application',
			volunteer_id: volunteerId,
			job_id: jobId,
			shift_id: selectedShiftId,
			status: { $in: ['confirmed', 'pending_review'] }
		},
		{ limit: 1 }
	);
	if (docsFrom(duplicate.data).length > 0) {
		throw new PublicApplicationError('DUPLICATE_APPLICATION', 409);
	}
	const requestedShift = concreteShift(selected);
	if (
		requestedShift &&
		(await hasActiveBookingConflict(dbName, volunteerId, shiftDutyWindow(requestedShift)))
	) {
		throw new PublicApplicationError('TIME_CONFLICT', 409);
	}
	const now = new Date().toISOString();
	// 16 random bytes, hex-encoded (32 hex chars) — same convention as the backend's
	// `secrets.token_hex(16)` for this prefix, not a ULID: this is a bearer secret, not an
	// identifier, so it must come from a CSPRNG rather than something with a time component.
	const trackingToken = formatMintedTicketToken(randomBytes(TRACKING_TOKEN_RANDOM_BYTES));
	const trackingTokenHash = await sha256Hex(trackingToken);

	// Per-volunteer token (separate from the per-application `trackingToken` above): minted
	// once the first time this volunteer applies, then reused for every later application,
	// the public pass, portal login, and on-site check-in. An existing volunteer keeps
	// whatever hash it already has — the plaintext can never be recovered from a hash, so a
	// volunteer that already has one must never have it silently replaced.
	const existingVolunteerToken = existing?.tracking_token_hash;
	const mintedVolunteerToken = existingVolunteerToken
		? null
		: formatMintedTicketToken(randomBytes(TRACKING_TOKEN_RANDOM_BYTES));
	const volunteerTokenHash = mintedVolunteerToken
		? await sha256Hex(mintedVolunteerToken)
		: existingVolunteerToken;
	const codesRes = await findAsPublicWriter(
		dbName,
		{ type: 'volunteer' },
		{ limit: 5000, fields: ['volunteer_code'] }
	);
	const existingCodes = docsFrom(codesRes.data)
		.map((doc) => doc.volunteer_code)
		.filter((code): code is string => typeof code === 'string');
	const mergedSkillVerifications = { ...(existing?.skill_verifications ?? {}) };
	for (const skill of skills) {
		if (!controlled.has(normalizedSkill(skill))) continue;
		const key =
			Object.keys(mergedSkillVerifications).find(
				(value) => normalizedSkill(value) === normalizedSkill(skill)
			) ?? skill;
		const record = mergedSkillVerifications[key];
		if (record?.status === 'verified' || record?.status === 'rejected') continue;
		mergedSkillVerifications[key] = {
			...(record ?? {}),
			status: 'pending',
			reviewed_at: record?.reviewed_at ?? null,
			reviewed_by: record?.reviewed_by ?? null,
			notes: record?.notes ?? null
		};
	}
	const volunteer = existing
		? {
				...existing,
				phone: normalizePhone(input.phone),
				phone_hash: phoneHash,
				skills: [
					...new Map(
						[...(existing.skills ?? []), ...skills].map((value) => [normalizedSkill(value), value])
					).values()
				],
				identity_verification: existing.identity_verification ?? {
					status: existing.identity_verified ? 'verified' : 'pending',
					reviewed_at: null,
					reviewed_by: null,
					notes: null
				},
				skill_verifications: mergedSkillVerifications,
				tracking_token_hash: volunteerTokenHash,
				updated_at: now,
				updated_by: 'public'
			}
		: {
				_id: volunteerId,
				type: 'volunteer',
				schema_v: 4,
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
				tracking_token_hash: volunteerTokenHash,
				status: 'active',
				checked_in: false,
				current_shelter_code: null,
				volunteer_code: nextVolunteerCode(existingCodes),
				identity_verified: false,
				identity_verification: {
					status: 'pending',
					reviewed_at: null,
					reviewed_by: null,
					notes: null
				},
				skill_verifications: mergedSkillVerifications,
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
			phone: normalizePhone(input.phone),
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
		review_reasons: reviewReasons(job, skills, controlled, reviewProfile),
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

	return {
		tracking_token: trackingToken,
		status,
		job_id: jobId,
		shift_id: verifiedShiftId,
		...(mintedVolunteerToken ? { volunteer_token: mintedVolunteerToken } : {})
	};
}

/** What became of one shift of a multi-shift request (#716). */
export type ShiftApplicationResult =
	| { ok: true; shift_id: string | null; status: string; tracking_token: string }
	| {
			ok: false;
			shift_id: string | null;
			error: PublicApplicationErrorCode;
			/** The status a single-shift request would have answered with. */
			http_status: number;
	  };

/**
 * Apply to several shifts of one job in one request (#716).
 *
 * Each shift goes through {@link applyPublicVolunteerApplication} on its own, so it gets the
 * same checks and the same writes as a single-shift request and lands as its own
 * `job_application` (CR-107: one application per shift). A shift that fails — full, already
 * applied for, overlapping — is reported and skipped; the shifts that passed stay saved.
 *
 * Only job-level faults (no such job, job closed, the writer refused) reject the whole
 * request, and they are checked once up front so they never come back once per shift.
 *
 * Every shift is judged for review against the applicant as they were before the request:
 * a new phone's first shift creates the profile, and without this the shifts after it would
 * be held for identity review that the first was not.
 *
 * Shifts are applied in the order given, and a shift that overlaps one already saved by this
 * request is answered `TIME_CONFLICT`: the booking-conflict check only sees shift
 * assignments, which a `pending_review` application does not have yet.
 */
export async function applyPublicVolunteerApplicationToShifts(
	jobIdInput: string,
	input: DirectApplicationInput,
	shifts: readonly ApplyShift[]
): Promise<{ job_id: string; volunteer_token?: string; results: ShiftApplicationResult[] }> {
	const jobId = normalizedJobId(jobIdInput);
	const shelterCode = await findShelterCodeForJob(jobId, input.shelter_code);
	if (!shelterCode) throw new PublicApplicationError('JOB_NOT_FOUND', 404);
	const job = await readJob(shelterDbName(shelterCode), jobId);
	if (job.type !== 'job' || job.shelter_code.toUpperCase() !== shelterCode) {
		throw new PublicApplicationError('JOB_NOT_FOUND', 404);
	}
	if (job.status !== 'open') throw new PublicApplicationError('JOB_NOT_OPEN', 409);
	const phoneHash = await sha256Hex(normalizePhone(input.phone));
	const newApplicant =
		(await matchingVolunteers(shelterDbName(shelterCode), phoneHash)).length === 0;

	const results: ShiftApplicationResult[] = [];
	const savedWindows: BookingWindow[] = [];
	const savedShiftIds = new Set<string>();
	let volunteerToken: string | undefined;

	for (const requested of shifts) {
		const shiftInput = {
			...input,
			shelter_code: shelterCode,
			shift_id: requested.shift_id,
			shift_date: requested.shift_date,
			start_time: requested.start_time,
			end_time: requested.end_time
		};
		let selected: CouchJobShift | null;
		try {
			selected = selectedShift(job, shiftInput);
		} catch (error) {
			results.push(failedShift(requested.shift_id ?? null, error));
			continue;
		}
		const id = shiftId(selected) ?? requested.shift_id ?? null;
		if (id && savedShiftIds.has(id)) {
			results.push({ ok: false, shift_id: id, error: 'DUPLICATE_APPLICATION', http_status: 409 });
			continue;
		}
		const concrete = concreteShift(selected);
		const window = concrete ? shiftDutyWindow(concrete) : null;
		if (window && savedWindows.some((saved) => windowsOverlap(window, saved))) {
			results.push({ ok: false, shift_id: id, error: 'TIME_CONFLICT', http_status: 409 });
			continue;
		}
		try {
			const result = await applyPublicVolunteerApplication(
				jobId,
				{
					...shiftInput,
					// The verified identity, so a date-only request cannot drift to another shift.
					shift_id: id ?? undefined
				},
				{ reviewAsNewApplicant: newApplicant }
			);
			results.push({
				ok: true,
				shift_id: result.shift_id ?? id,
				status: result.status,
				tracking_token: result.tracking_token
			});
			volunteerToken ??= result.volunteer_token;
			if (id) savedShiftIds.add(id);
			if (window) savedWindows.push(window);
		} catch (error) {
			results.push(failedShift(id, error));
		}
	}

	return {
		job_id: jobId,
		...(volunteerToken ? { volunteer_token: volunteerToken } : {}),
		results
	};
}

function failedShift(shiftIdValue: string | null, error: unknown): ShiftApplicationResult {
	if (error instanceof PublicApplicationError) {
		return { ok: false, shift_id: shiftIdValue, error: error.code, http_status: error.httpStatus };
	}
	console.error('[public-volunteer-apply] shift write failed', error);
	return { ok: false, shift_id: shiftIdValue, error: 'WRITE_FAILED', http_status: 502 };
}
