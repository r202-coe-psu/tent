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
import { PublicScheduleError, releaseJobQuota } from './public-schedule-action';

const MAX_WRITE_RETRIES = 5;
const CANCELLABLE_STATUSES = ['confirmed', 'pending_review'];

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
 * GET and cancel both go through here so the pass can never show one application and
 * cancel another.
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
			if (app) return { dbName, shelter, app, volunteer: null };

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
			const volApp =
				volAppsRes.status === 200
					? pickVolunteerApplication(docsOf<TicketApplicationDoc>(volAppsRes.data), now)
					: undefined;
			return { dbName, shelter, app: volApp ?? null, volunteer };
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
	now: Date
): Promise<TicketApplicationDoc> {
	const current = await getAsPublicWriter(dbName, applicationId);
	if (current.status !== 200 || !current.data) throw new TicketCancelError('TICKET_NOT_FOUND', 404);
	const app = current.data as TicketApplicationDoc;
	if (!CANCELLABLE_STATUSES.includes(String(app.status))) {
		throw new TicketCancelError('NOT_CANCELLABLE', 409);
	}
	if (shiftHasStarted(app, now)) throw new TicketCancelError('SHIFT_STARTED', 409);
	return app;
}

async function markApplicationCancelled(
	dbName: string,
	applicationId: string,
	now: Date
): Promise<void> {
	for (let attempt = 0; attempt < MAX_WRITE_RETRIES; attempt++) {
		// Re-checked on every read: a concurrent second cancel sees `cancelled` and gets 409.
		const app = await readCancellableApplication(dbName, applicationId, now);
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
	for (const assignment of docsOf<Doc & { _id: string }>(found.data)) {
		if (
			!assignmentMatchesApplication(
				app as unknown as JobApplication,
				assignment as unknown as ShiftAssignment
			)
		) {
			continue;
		}
		result.matched++;
		if (!['assigned', 'standby'].includes(String(assignment.status))) continue;
		for (let attempt = 0; attempt < MAX_WRITE_RETRIES; attempt++) {
			const fresh = await getAsPublicWriter(dbName, assignment._id);
			const doc = fresh.data as Doc | null;
			if (fresh.status !== 200 || !doc || !['assigned', 'standby'].includes(String(doc.status))) {
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
			break;
		}
	}
	return result;
}

/**
 * Applicant withdraws their own application from the pass. Writes CouchDB (the worker
 * projects to Mongo) and gives the quota back only for a `confirmed` application.
 *
 * Order matters so a failure midway can be retried: the application is marked `cancelled`
 * LAST, so until then it stays cancellable. Quota is released only when this call moved an
 * assignment to `cancelled` (or there is none), so a retry never releases twice; the rare
 * partial failure may under-release, never over-release.
 */
export async function cancelTicket(token: string, now = new Date()): Promise<void> {
	const ticket = await resolveTicket(token, now);
	if (!ticket?.app) throw new TicketCancelError('TICKET_NOT_FOUND', 404);
	const { dbName } = ticket;

	const app = await readCancellableApplication(dbName, ticket.app._id, now);
	const assignments = await cancelLinkedAssignments(dbName, app, now.toISOString());
	if (
		app.status === 'confirmed' &&
		app.job_id &&
		(assignments.cancelled > 0 || assignments.matched === 0)
	) {
		try {
			await releaseJobQuota(
				dbName,
				{
					_id: app._id,
					job_id: app.job_id,
					shift_id: app.shift_id ?? app.selected_shift?.shift_id
				},
				now.toISOString()
			);
		} catch (error) {
			if (error instanceof PublicScheduleError) throw new TicketCancelError('WRITE_FAILED', 502);
			throw error;
		}
	}
	await markApplicationCancelled(dbName, app._id, now);
}
