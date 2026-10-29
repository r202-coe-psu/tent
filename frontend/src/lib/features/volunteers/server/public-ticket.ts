import { sha256Hex } from '$lib/db/hash';
import { adminRaw } from '$lib/server/couch-admin';
import {
	getAsPublicWriter,
	findAsPublicWriter,
	putAsPublicWriter
} from '$lib/server/couch-public-writer';
import { assignmentMatchesApplication } from '../domain/applicant-attendance';
import { shiftStartInstant } from '../domain/duty-window';
import type { JobApplication } from '../domain/job-application.schema';
import type { ShiftAssignment } from '../domain/shift-assignment.schema';
import {
	LIVE_ASSIGNMENT_STATUSES,
	PublicScheduleError,
	releaseJobQuota
} from './public-schedule-action';

const MAX_WRITE_RETRIES = 5;
const CANCELLABLE_STATUSES = ['confirmed', 'pending_review'];
/** Assignment statuses meaning the person already started work: the pass can no longer be cancelled. */
const STARTED_ASSIGNMENT_STATUSES = ['checked_in', 'completed'];

export interface TicketApplicationDoc {
	_id: string;
	_rev?: string;
	type: string;
	job_id?: string;
	shift_id?: string;
	volunteer_id?: string;
	tracking_token?: string;
	tracking_token_hash?: string;
	status?: string;
	applicant?: {
		first_name?: string;
		last_name?: string;
		phone?: string;
		email?: string | null;
		skills?: string[];
	};
	selected_shift?: {
		shift_id?: string;
		date: string;
		start_time: string;
		end_time: string;
	};
	created_at?: string;
	[key: string]: unknown;
}

export interface TicketVolunteerDoc {
	_id: string;
	type: string;
	first_name: string;
	last_name?: string;
	phone?: string;
	volunteer_code?: string;
	tracking_token?: string;
	tracking_token_hash?: string;
	status?: string;
	created_at?: string;
}

export interface ResolvedTicket {
	dbName: string;
	shelter: { code: string; name: string };
	app: TicketApplicationDoc | null;
	volunteer: TicketVolunteerDoc | null;
	/** Every application this token stands for (one for an application token, all of a volunteer's otherwise). */
	applications: TicketApplicationDoc[];
}

export class TicketCancelError extends Error {
	constructor(
		readonly code: 'TICKET_NOT_FOUND' | 'NOT_CANCELLABLE' | 'SHIFT_STARTED' | 'WRITE_FAILED',
		readonly httpStatus: number
	) {
		super(code);
		this.name = 'TicketCancelError';
	}
}

type Doc = Record<string, unknown>;

function docsOf<T>(data: unknown): T[] {
	const docs = (data as { docs?: unknown } | undefined)?.docs;
	return Array.isArray(docs) ? (docs as T[]) : [];
}

const shiftDate = (app: TicketApplicationDoc) => app.selected_shift?.date ?? '';
const shiftStartKey = (app: TicketApplicationDoc) =>
	`${shiftDate(app)}T${app.selected_shift?.start_time || '00:00'}`;

/**
 * Which application a volunteer's permanent token stands for: the cancellable one that
 * starts soonest, else the most recent one (by shift date, then created_at).
 */
function pickVolunteerApplication(
	apps: TicketApplicationDoc[],
	now = new Date()
): TicketApplicationDoc | undefined {
	const upcoming = apps
		.filter((app) => isTicketCancellable(app, now))
		.sort((a, b) => shiftStartKey(a).localeCompare(shiftStartKey(b)));
	if (upcoming[0]) return upcoming[0];
	return [...apps].sort(
		(a, b) =>
			shiftDate(b).localeCompare(shiftDate(a)) ||
			(b.created_at ?? '').localeCompare(a.created_at ?? '')
	)[0];
}

/**
 * Resolve a pass token the way the public pass does: an application token first, then a
 * volunteer's permanent role-card token (which shows that volunteer's application).
 * For a permanent token the shown application is re-picked on every request, so it can
 * change between the pass render and a cancel; the cancel therefore carries the shown
 * application `_id` and `cancelTicket` only acts on it if it is in `applications`.
 */
export async function resolveTicket(
	token: string,
	now = new Date()
): Promise<ResolvedTicket | null> {
	const tokenHash = await sha256Hex(token);
	const shelterDbs = new Map<string, { code: string; name: string }>();
	shelterDbs.set('shelter_sh001', { code: 'SH001', name: 'ศูนย์พักพิงหลัก (SH001)' });

	try {
		const regRes = await adminRaw('/registry/_all_docs?include_docs=true', 'GET');
		const rows = (regRes.data as { rows?: { doc?: Doc }[] } | undefined)?.rows;
		if (regRes.status === 200 && Array.isArray(rows)) {
			for (const { doc } of rows) {
				if (doc && doc.type === 'shelter' && doc.db) {
					shelterDbs.set(String(doc.db), {
						code: String(doc.code || 'SH001'),
						name: String(doc.name || doc.code || 'SH001')
					});
				}
			}
		}
	} catch {
		// Ignore registry error
	}

	// The public credential is the unguessable tracking token. CouchDB document IDs are
	// internal references and must never become an alternate credential.
	const byToken = { $or: [{ tracking_token_hash: tokenHash }, { tracking_token: token }] };

	for (const [dbName, shelter] of shelterDbs.entries()) {
		try {
			const appRes = await adminRaw(`/${dbName}/_find`, 'POST', {
				selector: { type: 'job_application', ...byToken },
				limit: 1
			});
			const app = appRes.status === 200 ? docsOf<TicketApplicationDoc>(appRes.data)[0] : undefined;
			if (app) return { dbName, shelter, app, volunteer: null, applications: [app] };

			const volRes = await adminRaw(`/${dbName}/_find`, 'POST', {
				selector: { type: 'volunteer', ...byToken },
				limit: 1
			});
			const volunteer =
				volRes.status === 200 ? docsOf<TicketVolunteerDoc>(volRes.data)[0] : undefined;
			if (!volunteer) continue;
			const volAppsRes = await adminRaw(`/${dbName}/_find`, 'POST', {
				selector: { type: 'job_application', volunteer_id: volunteer._id },
				limit: 200
			});
			const volApps =
				volAppsRes.status === 200 ? docsOf<TicketApplicationDoc>(volAppsRes.data) : [];
			const volApp = pickVolunteerApplication(volApps, now);
			return { dbName, shelter, app: volApp ?? null, volunteer, applications: volApps };
		} catch {
			// Continue to next shelter db
		}
	}
	return null;
}

/** True once the application's shift has begun (Asia/Bangkok wall clock). */
function shiftHasStarted(app: TicketApplicationDoc, now: Date): boolean {
	const shift = app.selected_shift;
	if (!shift?.date) return true;
	try {
		return now >= shiftStartInstant(shift.date, shift.start_time || '00:00');
	} catch {
		return true;
	}
}

/** Cancellable = still live (confirmed / pending_review) and the shift has not started. */
export function isTicketCancellable(app: TicketApplicationDoc | null, now = new Date()): boolean {
	return (
		app !== null && CANCELLABLE_STATUSES.includes(String(app.status)) && !shiftHasStarted(app, now)
	);
}

/** Re-read the application and check it can still be cancelled (same errors as the final write). */
async function readCancellableApplication(
	dbName: string,
	applicationId: string,
	now: Date,
	expectedStatus?: string
): Promise<TicketApplicationDoc> {
	const current = await getAsPublicWriter(dbName, applicationId);
	if (current.status !== 200 || !current.data) throw new TicketCancelError('TICKET_NOT_FOUND', 404);
	const app = current.data as TicketApplicationDoc;
	if (!CANCELLABLE_STATUSES.includes(String(app.status))) {
		throw new TicketCancelError('NOT_CANCELLABLE', 409);
	}
	// Status moved since the request began (e.g. staff approved it): abort, write nothing.
	if (expectedStatus !== undefined && app.status !== expectedStatus) {
		throw new TicketCancelError('NOT_CANCELLABLE', 409);
	}
	if (shiftHasStarted(app, now)) throw new TicketCancelError('SHIFT_STARTED', 409);
	return app;
}

async function markApplicationCancelled(
	dbName: string,
	applicationId: string,
	now: Date,
	expectedStatus: string
): Promise<void> {
	for (let attempt = 0; attempt < MAX_WRITE_RETRIES; attempt++) {
		// Re-checked on every read: a concurrent second cancel sees `cancelled` and gets 409.
		const app = await readCancellableApplication(dbName, applicationId, now, expectedStatus);
		const next = { ...app, status: 'cancelled', updated_at: now.toISOString() };
		const put = await putAsPublicWriter(dbName, applicationId, next);
		if (put.status === 409) continue;
		if (put.status >= 400) throw new TicketCancelError('WRITE_FAILED', 502);
		return;
	}
	throw new TicketCancelError('WRITE_FAILED', 409);
}

async function cancelLinkedAssignments(
	dbName: string,
	app: TicketApplicationDoc,
	nowIso: string
): Promise<{ cancelled: number; matched: number }> {
	const result = { cancelled: 0, matched: 0 };
	if (!app.volunteer_id) return result;
	const found = await findAsPublicWriter(
		dbName,
		{ type: 'shift_assignment', volunteer_id: app.volunteer_id, job_id: app.job_id },
		{ limit: 100 }
	);
	if (found.status !== 200) throw new TicketCancelError('WRITE_FAILED', 502);
	const linked = docsOf<Doc & { _id: string }>(found.data).filter((assignment) =>
		assignmentMatchesApplication(
			app as unknown as JobApplication,
			assignment as unknown as ShiftAssignment
		)
	);
	// Already checked in / completed: refuse before writing anything.
	if (linked.some((a) => STARTED_ASSIGNMENT_STATUSES.includes(String(a.status)))) {
		throw new TicketCancelError('SHIFT_STARTED', 409);
	}
	for (const assignment of linked) {
		result.matched++;
		if (!LIVE_ASSIGNMENT_STATUSES.includes(String(assignment.status))) continue;
		let settled = false;
		for (let attempt = 0; attempt < MAX_WRITE_RETRIES && !settled; attempt++) {
			const fresh = await getAsPublicWriter(dbName, assignment._id);
			// Deleted meanwhile: nothing left to cancel, and no quota of ours to give back.
			if (fresh.status === 404) {
				settled = true;
				break;
			}
			// Any other failed read throws so the application stays cancellable for a retry.
			if (fresh.status !== 200 || !fresh.data) throw new TicketCancelError('WRITE_FAILED', 502);
			const doc = fresh.data as Doc;
			// Checked in concurrently: too late to cancel.
			if (STARTED_ASSIGNMENT_STATUSES.includes(String(doc.status))) {
				throw new TicketCancelError('SHIFT_STARTED', 409);
			}
			// Moved on concurrently (withdrawn): nothing left here to cancel.
			if (!LIVE_ASSIGNMENT_STATUSES.includes(String(doc.status))) {
				settled = true;
				break;
			}
			const put = await putAsPublicWriter(dbName, assignment._id, {
				...doc,
				status: 'cancelled',
				updated_at: nowIso
			});
			if (put.status === 409) continue;
			if (put.status >= 400) throw new TicketCancelError('WRITE_FAILED', 502);
			result.cancelled++;
			settled = true;
		}
		if (!settled) throw new TicketCancelError('WRITE_FAILED', 409);
	}
	return result;
}

/**
 * Applicant withdraws their own application from the pass. Writes CouchDB (the worker
 * projects to Mongo) and gives the quota back only for a `confirmed` application.
 * `applicationId` is the application the pass showed; it must belong to the token and
 * still be cancellable, otherwise 409 (the pass is stale, e.g. a permanent token whose
 * shown application changed).
 *
 * Linked assignment path: cancel assignment -> release quota -> mark application. The
 * application is marked `cancelled` LAST, so until then it stays cancellable, and quota is
 * released only when this call moved an assignment to `cancelled`, so a retry never
 * releases twice.
 *
 * No linked assignment: there is no assignment to act as a once-only marker, so the
 * application is marked `cancelled` FIRST (with its `_rev`: a concurrent cancel conflicts
 * and then sees `cancelled`), and quota is released after. If that release fails quota is
 * short by 1, never over by 1 (known limitation, #1003).
 */
export async function cancelTicket(
	token: string,
	applicationId: string,
	now = new Date()
): Promise<void> {
	const ticket = await resolveTicket(token, now);
	if (!ticket?.app) throw new TicketCancelError('TICKET_NOT_FOUND', 404);
	if (!applicationId || !ticket.applications.some((a) => a._id === applicationId)) {
		throw new TicketCancelError('NOT_CANCELLABLE', 409);
	}
	const { dbName } = ticket;

	const app = await readCancellableApplication(dbName, applicationId, now);
	const status = String(app.status);
	const assignments = await cancelLinkedAssignments(dbName, app, now.toISOString());
	const releaseQuota = async () => {
		try {
			await releaseJobQuota(
				dbName,
				{
					_id: app._id,
					job_id: app.job_id as string,
					shift_id: app.shift_id ?? app.selected_shift?.shift_id
				},
				now.toISOString()
			);
		} catch (error) {
			if (error instanceof PublicScheduleError) throw new TicketCancelError('WRITE_FAILED', 502);
			throw error;
		}
	};
	const owesQuota = status === 'confirmed' && !!app.job_id;

	if (assignments.matched === 0) {
		await markApplicationCancelled(dbName, app._id, now, status);
		if (owesQuota) await releaseQuota();
		return;
	}
	if (owesQuota && assignments.cancelled > 0) await releaseQuota();
	await markApplicationCancelled(dbName, app._id, now, status);
}
