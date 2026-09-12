import { sha256Hex } from '$lib/db/hash';
import type {
	PortalCredential,
	ScheduleShift
} from '$lib/features/volunteer-portal/domain/volunteer';
import {
	findAsPublicWriter,
	getAsPublicWriter,
	putAsPublicWriter
} from '$lib/server/couch-public-writer';
import { adminRaw } from '$lib/server/couch-admin';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { isWithinDutyWindow } from '../domain/duty-window';

const MAX_WRITE_RETRIES = 5;

type CouchDoc = {
	_id: string;
	_rev?: string;
	type?: string;
	[key: string]: unknown;
};

type ShelterRef = {
	dbName: string;
	code: string;
	name: string;
};

type ResolvedIdentity = {
	ref: ShelterRef;
	volunteerIds: Set<string>;
};

export type PublicScheduleAction = 'check_in' | 'check_out' | 'withdraw';

export type PublicScheduleActionResult = {
	success: true;
	assignment_id: string;
	status: string;
	requested_at: string;
};

export class PublicScheduleError extends Error {
	constructor(
		readonly code:
			| 'INVALID_CREDENTIAL'
			| 'SHIFT_NOT_FOUND'
			| 'SHIFT_NOT_READY_FOR_CHECK_IN'
			| 'SHIFT_NOT_CHECKED_IN'
			| 'SHIFT_NOT_WITHDRAWABLE'
			| 'WRITE_FAILED'
			| 'SCHEDULE_UNAVAILABLE',
		readonly httpStatus = 409
	) {
		super(code);
		this.name = 'PublicScheduleError';
	}
}

function docsFrom(data: unknown): CouchDoc[] {
	if (!data || typeof data !== 'object' || !Array.isArray((data as { docs?: unknown }).docs)) {
		return [];
	}
	return (data as { docs: unknown[] }).docs.filter(
		(doc): doc is CouchDoc =>
			Boolean(doc) && typeof doc === 'object' && typeof (doc as CouchDoc)._id === 'string'
	);
}

function normalizePhone(value: string): string {
	const digits = value.replace(/[\s\-()]/g, '');
	if (digits.startsWith('+66')) return `0${digits.slice(3)}`;
	if (digits.startsWith('66') && digits.length >= 11) return `0${digits.slice(2)}`;
	return digits;
}

function isViewToken(value: string): boolean {
	return value.trim().toUpperCase().startsWith('VIEW-');
}

function tokenHash(value: string): Promise<string> {
	return sha256Hex(value.trim().toUpperCase());
}

function assignmentDbFallback(): ShelterRef[] {
	return [{ dbName: shelterDbName('SH001'), code: 'SH001', name: 'ศูนย์พักพิงหลัก (SH001)' }];
}

async function shelterRefs(): Promise<ShelterRef[]> {
	const refs = new Map<string, ShelterRef>();
	for (const ref of assignmentDbFallback()) refs.set(ref.dbName, ref);
	try {
		const result = await adminRaw('/registry/_all_docs?include_docs=true', 'GET');
		const rows = (result.data as { rows?: { doc?: Record<string, unknown> }[] } | null)?.rows ?? [];
		for (const row of rows) {
			const doc = row.doc;
			if (doc?.type !== 'shelter' || typeof doc.code !== 'string') continue;
			const code = doc.code.toUpperCase();
			refs.set(shelterDbName(code), {
				dbName: shelterDbName(code),
				code,
				name: typeof doc.name === 'string' ? doc.name : code
			});
		}
	} catch {
		// The seeded SH001 fallback keeps local development usable when registry is offline.
	}
	return [...refs.values()];
}

function filterPortalId(ids: Set<string>, portalId?: string): Set<string> {
	if (!portalId) return ids;
	return ids.has(portalId) ? new Set([portalId]) : new Set();
}

async function resolveIdentities(credential: PortalCredential): Promise<ResolvedIdentity[]> {
	if (credential.token && isViewToken(credential.token)) {
		throw new PublicScheduleError('SHIFT_NOT_FOUND', 404);
	}

	const refs = await shelterRefs();
	const identities: ResolvedIdentity[] = [];
	const phoneHash = credential.phone ? await sha256Hex(normalizePhone(credential.phone)) : null;
	const trackingHash = credential.token ? await tokenHash(credential.token) : null;

	for (const ref of refs) {
		const volunteerIds = new Set<string>();
		if (phoneHash) {
			const result = await findAsPublicWriter(
				ref.dbName,
				{ type: 'volunteer', phone_hash: phoneHash },
				{ limit: 100 }
			);
			for (const doc of docsFrom(result.data)) volunteerIds.add(doc._id);
		} else if (trackingHash && credential.token) {
			const appResult = await findAsPublicWriter(
				ref.dbName,
				{
					type: 'job_application',
					$or: [{ tracking_token_hash: trackingHash }, { tracking_token: credential.token }]
				},
				{ limit: 100 }
			);
			for (const doc of docsFrom(appResult.data)) {
				if (typeof doc.volunteer_id === 'string') volunteerIds.add(doc.volunteer_id);
			}
			const volunteerResult = await findAsPublicWriter(
				ref.dbName,
				{
					type: 'volunteer',
					$or: [{ tracking_token_hash: trackingHash }, { tracking_token: credential.token }]
				},
				{ limit: 100 }
			);
			for (const doc of docsFrom(volunteerResult.data)) volunteerIds.add(doc._id);
		}

		const scopedIds = filterPortalId(volunteerIds, credential.portal_id);
		if (scopedIds.size > 0) identities.push({ ref, volunteerIds: scopedIds });
	}
	return identities;
}

function isOwnedAssignment(
	doc: CouchDoc,
	identity: ResolvedIdentity,
	assignmentId: string
): boolean {
	return (
		doc._id === assignmentId &&
		doc.type === 'shift_assignment' &&
		typeof doc.volunteer_id === 'string' &&
		identity.volunteerIds.has(doc.volunteer_id)
	);
}

function actionError(action: PublicScheduleAction): PublicScheduleError {
	if (action === 'check_in') return new PublicScheduleError('SHIFT_NOT_READY_FOR_CHECK_IN');
	if (action === 'check_out') return new PublicScheduleError('SHIFT_NOT_CHECKED_IN');
	return new PublicScheduleError('SHIFT_NOT_WITHDRAWABLE');
}

function applyAssignmentAction(doc: CouchDoc, action: PublicScheduleAction, now: string): CouchDoc {
	const next = structuredClone(doc) as CouchDoc;
	next.updated_at = now;
	if (action === 'check_in') {
		next.status = 'checked_in';
		next.check_in_at = now;
		next.check_in_by = 'volunteer_portal';
		next.check_in_method = 'portal';
		next.check_in_reason = null;
	} else if (action === 'check_out') {
		next.status = 'completed';
		next.check_out_at = now;
		next.check_out_by = 'volunteer_portal';
		next.check_out_method = 'portal';
		next.check_out_reason = null;
	} else {
		next.status = 'cancelled';
	}
	return next;
}

async function writeAssignment(
	dbName: string,
	assignmentId: string,
	identity: ResolvedIdentity,
	action: PublicScheduleAction,
	now: string
): Promise<CouchDoc> {
	for (let attempt = 0; attempt < MAX_WRITE_RETRIES; attempt++) {
		const currentResult = await getAsPublicWriter(dbName, assignmentId);
		if (currentResult.status !== 200 || !currentResult.data) {
			throw new PublicScheduleError('SHIFT_NOT_FOUND', 404);
		}
		const current = currentResult.data as CouchDoc;
		if (!isOwnedAssignment(current, identity, assignmentId)) {
			throw new PublicScheduleError('SHIFT_NOT_FOUND', 404);
		}
		if (current.dispatch_status === 'dispatched') throw actionError(action);
		if (action === 'check_in') {
			const rawWindow = current.duty_window;
			const dutyWindow =
				rawWindow &&
				typeof rawWindow === 'object' &&
				typeof (rawWindow as { start_ts?: unknown }).start_ts === 'string' &&
				typeof (rawWindow as { end_ts?: unknown }).end_ts === 'string'
					? {
							start_ts: (rawWindow as { start_ts: string }).start_ts,
							end_ts: (rawWindow as { end_ts: string }).end_ts
						}
					: null;
			if (!isWithinDutyWindow(now, dutyWindow)) {
				throw new PublicScheduleError('SHIFT_NOT_READY_FOR_CHECK_IN', 409);
			}
		}
		const allowed =
			(action === 'check_in' && ['assigned', 'standby'].includes(String(current.status))) ||
			(action === 'check_out' && current.status === 'checked_in') ||
			(action === 'withdraw' && ['assigned', 'standby'].includes(String(current.status)));
		if (!allowed) throw actionError(action);

		const next = applyAssignmentAction(current, action, now);
		const put = await putAsPublicWriter(dbName, assignmentId, next);
		if (put.status === 409) continue;
		if (put.status >= 400) throw new PublicScheduleError('WRITE_FAILED', 502);
		return next;
	}
	throw new PublicScheduleError('WRITE_FAILED', 409);
}

async function updateVolunteerAttendance(
	dbName: string,
	volunteerId: string,
	checkedIn: boolean,
	shelterCode: string,
	now: string,
	assignmentId: string
): Promise<void> {
	for (let attempt = 0; attempt < MAX_WRITE_RETRIES; attempt++) {
		const currentResult = await getAsPublicWriter(dbName, volunteerId);
		if (currentResult.status !== 200 || !currentResult.data) {
			throw new PublicScheduleError('WRITE_FAILED', 502);
		}
		const current = currentResult.data as CouchDoc;
		if (current.type !== 'volunteer') throw new PublicScheduleError('WRITE_FAILED', 502);
		let effectiveCheckedIn = checkedIn;
		let effectiveShelterCode: string | null = checkedIn ? shelterCode : null;
		if (!checkedIn) {
			const activeResult = await findAsPublicWriter(
				dbName,
				{ type: 'shift_assignment', volunteer_id: volunteerId, status: 'checked_in' },
				{ limit: 100, fields: ['_id', 'shelter_code'] }
			);
			const otherActiveAssignment = docsFrom(activeResult.data).find(
				(doc) => doc._id !== assignmentId
			);
			if (otherActiveAssignment) {
				effectiveCheckedIn = true;
				effectiveShelterCode =
					typeof otherActiveAssignment.shelter_code === 'string'
						? otherActiveAssignment.shelter_code
						: shelterCode;
			}
		}
		const next = {
			...current,
			checked_in: effectiveCheckedIn,
			current_shelter_code: effectiveCheckedIn ? effectiveShelterCode : null,
			updated_at: now
		};
		const put = await putAsPublicWriter(dbName, volunteerId, next);
		if (put.status === 409) continue;
		if (put.status >= 400) throw new PublicScheduleError('WRITE_FAILED', 502);
		return;
	}
	throw new PublicScheduleError('WRITE_FAILED', 409);
}

async function releaseJobQuota(dbName: string, assignment: CouchDoc, now: string): Promise<void> {
	if (typeof assignment.job_id !== 'string') throw new PublicScheduleError('WRITE_FAILED', 502);
	for (let attempt = 0; attempt < MAX_WRITE_RETRIES; attempt++) {
		const jobResult = await getAsPublicWriter(dbName, assignment.job_id);
		if (jobResult.status !== 200 || !jobResult.data)
			throw new PublicScheduleError('WRITE_FAILED', 502);
		const job = structuredClone(jobResult.data) as CouchDoc;
		const shifts = Array.isArray(job.shifts) ? (job.shifts as CouchDoc[]) : [];
		const shiftId = typeof assignment.shift_id === 'string' ? assignment.shift_id : null;
		const shift = shifts.find((item) => item.shift_id === shiftId || item.id === shiftId);
		if (shift) {
			const confirmed = Number(shift.slots_confirmed ?? 0);
			if (confirmed > 0) {
				shift.slots_confirmed = confirmed - 1;
				shift.slots_remaining = Number(shift.slots_remaining ?? 0) + 1;
			}
		}
		job.slots_confirmed = Math.max(Number(job.slots_confirmed ?? 0) - 1, 0);
		job.slots_remaining = Number(job.slots_remaining ?? 0) + 1;
		job.status = 'open';
		job.updated_at = now;
		const put = await putAsPublicWriter(dbName, assignment.job_id, job);
		if (put.status === 409) continue;
		if (put.status >= 400) throw new PublicScheduleError('WRITE_FAILED', 502);
		return;
	}
	throw new PublicScheduleError('WRITE_FAILED', 409);
}

export async function applyPublicScheduleAction(
	credential: PortalCredential,
	assignmentId: string,
	action: PublicScheduleAction
): Promise<PublicScheduleActionResult> {
	if (action === 'withdraw' && !credential.token) {
		throw new PublicScheduleError('INVALID_CREDENTIAL', 401);
	}
	const identities = await resolveIdentities(credential);
	if (identities.length === 0) throw new PublicScheduleError('SHIFT_NOT_FOUND', 404);
	const now = new Date().toISOString();

	for (const identity of identities) {
		const assignmentResult = await getAsPublicWriter(identity.ref.dbName, assignmentId);
		if (assignmentResult.status !== 200 || !assignmentResult.data) continue;
		const assignment = assignmentResult.data as CouchDoc;
		if (!isOwnedAssignment(assignment, identity, assignmentId)) continue;
		const saved = await writeAssignment(identity.ref.dbName, assignmentId, identity, action, now);
		if (action === 'check_in' || action === 'check_out') {
			await updateVolunteerAttendance(
				identity.ref.dbName,
				String(saved.volunteer_id),
				action === 'check_in',
				identity.ref.code,
				now,
				assignmentId
			);
		}
		if (action === 'withdraw') await releaseJobQuota(identity.ref.dbName, saved, now);
		return {
			success: true,
			assignment_id: assignmentId,
			status: String(saved.status),
			requested_at: now
		};
	}

	throw new PublicScheduleError('SHIFT_NOT_FOUND', 404);
}

function scheduleShift(
	assignment: CouchDoc,
	job: CouchDoc | null,
	shelter: ShelterRef
): ScheduleShift {
	const window = (assignment.duty_window ?? {}) as Record<string, unknown>;
	return {
		assignment_id: assignment._id,
		job_id: String(assignment.job_id ?? ''),
		shift_id: typeof assignment.shift_id === 'string' ? assignment.shift_id : null,
		job_title: typeof job?.title === 'string' ? job.title : '',
		shelter_code: shelter.code,
		shelter_name: shelter.name,
		date: String(assignment.date ?? ''),
		shift: String(assignment.shift ?? ''),
		station: String(assignment.station ?? ''),
		start_ts: typeof window.start_ts === 'string' ? window.start_ts : null,
		end_ts: typeof window.end_ts === 'string' ? window.end_ts : null,
		check_in_at: typeof assignment.check_in_at === 'string' ? assignment.check_in_at : null,
		check_out_at: typeof assignment.check_out_at === 'string' ? assignment.check_out_at : null,
		status: String(assignment.status ?? ''),
		dispatch_status:
			typeof assignment.dispatch_status === 'string' ? assignment.dispatch_status : null
	};
}

export async function readPublicVolunteerSchedule(
	credential: PortalCredential
): Promise<{ success: true; shifts: ScheduleShift[] }> {
	const identities = await resolveIdentities(credential);
	const rows = new Map<string, ScheduleShift>();
	for (const identity of identities) {
		const result = await findAsPublicWriter(
			identity.ref.dbName,
			{ type: 'shift_assignment', volunteer_id: { $in: [...identity.volunteerIds] } },
			{ limit: 100 }
		);
		for (const assignment of docsFrom(result.data)) {
			if (
				!['assigned', 'standby', 'checked_in', 'completed', 'no_show'].includes(
					String(assignment.status)
				)
			)
				continue;
			const job =
				typeof assignment.job_id === 'string'
					? ((await getAsPublicWriter(identity.ref.dbName, assignment.job_id))
							.data as CouchDoc | null)
					: null;
			rows.set(assignment._id, scheduleShift(assignment, job, identity.ref));
		}
	}
	const shifts = [...rows.values()].sort((left, right) =>
		(left.start_ts ?? left.date).localeCompare(right.start_ts ?? right.date)
	);
	return { success: true, shifts };
}
