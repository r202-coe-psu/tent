/**
 * Shelter close job store (CR-243 FR-1..FR-4, FR-12..FR-14, FR-3a).
 *
 * `shelter_close_job:<ulid>` and `shelter_close_lock:<code>` live in the central `central_ops`
 * DB — never in `shelter_<code>` (FR-4). Workers find jobs through the `jobs_claimable` view of
 * `_design/shelter_close` (FR-1), never by scanning the DB. Every write is a CAS on `_rev`.
 *
 * Deliberately free of `$env` and `@sveltejs/kit` (the backfill script and tests use it): the
 * CouchDB admin request, clock, id minting and config are all injected.
 */

import { ulid as defaultUlid } from '$lib/db/ulid';
import type {
	ShelterCloseEndReason,
	ShelterCloseJobCounters,
	ShelterCloseJobCursor,
	ShelterCloseJobFailure,
	ShelterCloseJobMode,
	ShelterCloseJobPhase,
	ShelterCloseJobStatus,
	ShelterCloseJobView,
	ShelterClosePreview
} from '$lib/features/shelters/server';
import type { CouchReq } from './ensure-public-writer';

export const SHELTER_CLOSE_DB = 'central_ops';
export const SHELTER_CLOSE_DESIGN_ID = '_design/shelter_close';
export const SHELTER_CLOSE_VIEW = 'jobs_claimable';
export const SHELTER_CLOSE_JOB_PREFIX = 'shelter_close_job:';
export const SHELTER_CLOSE_LOCK_PREFIX = 'shelter_close_lock:';
/** Bump when the view map changes so `ensureDesign` redeploys it. */
export const SHELTER_CLOSE_DESIGN_VERSION = 1;

// ------------------------------------------------------------------ config (CR-243 §4)

export interface ShelterCloseConfig {
	chunkBudgetMs: number;
	timeoutMs: number;
	leaseMs: number;
	staleMs: number;
	maxAttempts: number;
	maxFailures: number;
}

export const SHELTER_CLOSE_DEFAULTS: ShelterCloseConfig = {
	chunkBudgetMs: 20_000,
	timeoutMs: 30_000,
	leaseMs: 60_000,
	staleMs: 600_000,
	maxAttempts: 5,
	maxFailures: 50
};

function positiveInt(raw: string | undefined, fallback: number): number {
	if (raw === undefined || raw.trim() === '') return fallback;
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Reads the `SHELTER_CLOSE_*` env vars (§4); unset / invalid values fall back to the default. */
export function readShelterCloseConfig(
	env: Record<string, string | undefined>
): ShelterCloseConfig {
	return {
		chunkBudgetMs: positiveInt(
			env.SHELTER_CLOSE_CHUNK_BUDGET_MS,
			SHELTER_CLOSE_DEFAULTS.chunkBudgetMs
		),
		timeoutMs: positiveInt(env.SHELTER_CLOSE_WORKER_TIMEOUT_MS, SHELTER_CLOSE_DEFAULTS.timeoutMs),
		leaseMs: positiveInt(env.SHELTER_CLOSE_LEASE_MS, SHELTER_CLOSE_DEFAULTS.leaseMs),
		staleMs: positiveInt(env.SHELTER_CLOSE_STALE_MS, SHELTER_CLOSE_DEFAULTS.staleMs),
		maxAttempts: positiveInt(env.SHELTER_CLOSE_MAX_ATTEMPTS, SHELTER_CLOSE_DEFAULTS.maxAttempts),
		maxFailures: positiveInt(env.SHELTER_CLOSE_MAX_FAILURES, SHELTER_CLOSE_DEFAULTS.maxFailures)
	};
}

// ------------------------------------------------------------------ docs

export interface ShelterCloseJob {
	_id: string;
	_rev?: string;
	type: 'shelter_close_job';
	schema_v: 1;
	job_ulid: string;
	shelter_code: string;
	mode: ShelterCloseJobMode;
	requested_by: string;
	status: ShelterCloseJobStatus;
	phase: ShelterCloseJobPhase;
	cursor: ShelterCloseJobCursor;
	sweep_round: number;
	counters: ShelterCloseJobCounters;
	preview: ShelterClosePreview;
	failures: ShelterCloseJobFailure[];
	lease_owner?: string;
	lease_until?: string;
	attempt: number;
	created_at: string;
	updated_at: string;
	started_at?: string;
	finished_at?: string;
	closed: boolean;
	end_reason?: ShelterCloseEndReason;
}

export interface ShelterCloseLock {
	_id: string;
	_rev?: string;
	type: 'shelter_close_lock';
	schema_v: 1;
	shelter_code: string;
	/** Full `_id` of the job holding the lock. */
	job_id: string;
	created_at: string;
}

export const isTerminalShelterCloseJob = (job: Pick<ShelterCloseJob, 'status'>): boolean =>
	job.status === 'completed' || job.status === 'completed_with_errors';

/** `_id` or bare ulid -> bare ulid (the id exposed by the API). */
export function shelterCloseJobUlid(id: string): string {
	return id.startsWith(SHELTER_CLOSE_JOB_PREFIX) ? id.slice(SHELTER_CLOSE_JOB_PREFIX.length) : id;
}

export const shelterCloseLockId = (code: string) =>
	`${SHELTER_CLOSE_LOCK_PREFIX}${code.toUpperCase()}`;

/** FR-8 DTO: no internals (lease owner, cursor, `_rev`, requester). */
export function toShelterCloseJobView(job: ShelterCloseJob): ShelterCloseJobView {
	return {
		job_id: job.job_ulid,
		shelter_code: job.shelter_code,
		mode: job.mode,
		status: job.status,
		phase: job.phase,
		sweep_round: job.sweep_round,
		counters: job.counters,
		preview: {
			by_status: job.preview.by_status as Record<string, number>,
			total: job.preview.total
		},
		failures: job.failures,
		closed: job.closed,
		...(job.end_reason ? { end_reason: job.end_reason } : {}),
		created_at: job.created_at,
		updated_at: job.updated_at,
		...(job.started_at ? { started_at: job.started_at } : {}),
		...(job.finished_at ? { finished_at: job.finished_at } : {})
	};
}

const JOBS_CLAIMABLE_MAP = `function (doc) {
  if (doc.type === 'shelter_close_job' && (doc.status === 'queued' || doc.status === 'running')) {
    emit([doc.status, doc.lease_until || doc.created_at], null);
  }
}`;

export function buildShelterCloseDesignDoc() {
	return {
		_id: SHELTER_CLOSE_DESIGN_ID,
		version: SHELTER_CLOSE_DESIGN_VERSION,
		language: 'javascript',
		views: { [SHELTER_CLOSE_VIEW]: { map: JOBS_CLAIMABLE_MAP } }
	};
}

/** Thrown when a CAS write lost (`409`): the caller re-reads and decides (FR-13). */
export class ShelterCloseJobConflictError extends Error {
	constructor(id: string) {
		super(`Conflict writing ${id}`);
		this.name = 'ShelterCloseJobConflictError';
	}
}

export type CreateShelterCloseJobResult =
	{ created: true; job: ShelterCloseJob } | { created: false; job_id: string };

export interface ShelterCloseJobStoreDeps {
	couchReq: CouchReq;
	/** Epoch ms; inject a fake clock in tests. */
	now?: () => number;
	ulid?: () => string;
	config?: Partial<ShelterCloseConfig>;
}

export type ShelterCloseJobStore = ReturnType<typeof createShelterCloseJobStore>;

export function createShelterCloseJobStore(deps: ShelterCloseJobStoreDeps) {
	const { couchReq } = deps;
	const nowMs = deps.now ?? (() => Date.now());
	const newUlid = deps.ulid ?? defaultUlid;
	const config: ShelterCloseConfig = { ...SHELTER_CLOSE_DEFAULTS, ...deps.config };
	const iso = (ms: number = nowMs()) => new Date(ms).toISOString();
	const enc = encodeURIComponent;
	let ready: Promise<void> | null = null;

	async function ensureReady(): Promise<void> {
		const db = await couchReq('PUT', `/${SHELTER_CLOSE_DB}`);
		if (db.status >= 300 && db.status !== 412) {
			throw new Error(`Could not ensure ${SHELTER_CLOSE_DB} (${db.status})`);
		}
		const desired = buildShelterCloseDesignDoc();
		const path = `/${SHELTER_CLOSE_DB}/${SHELTER_CLOSE_DESIGN_ID}`;
		const existing = await couchReq('GET', path);
		if (existing.status === 200) {
			const cur = existing.data as { _rev: string; version?: number };
			if (cur.version === desired.version) return;
			const res = await couchReq('PUT', path, { ...desired, _rev: cur._rev });
			if (res.status >= 300 && res.status !== 409) {
				throw new Error(`Could not update ${SHELTER_CLOSE_DESIGN_ID} (${res.status})`);
			}
			return;
		}
		const res = await couchReq('PUT', path, desired);
		if (res.status >= 300 && res.status !== 409) {
			throw new Error(`Could not create ${SHELTER_CLOSE_DESIGN_ID} (${res.status})`);
		}
	}

	/** Creates `central_ops` + the view once per store. */
	const ensureDesign = (): Promise<void> => {
		ready ??= ensureReady().catch((err) => {
			ready = null;
			throw err;
		});
		return ready;
	};

	async function getDoc<T>(id: string): Promise<T | null> {
		const res = await couchReq('GET', `/${SHELTER_CLOSE_DB}/${enc(id)}`);
		if (res.status === 404) return null;
		if (res.status >= 400) throw new Error(`Could not read ${id} (${res.status})`);
		return res.data as T;
	}

	/** CAS put; `409` -> {@link ShelterCloseJobConflictError}. Returns the doc with the new `_rev`. */
	async function putDoc<T extends { _id: string; _rev?: string }>(doc: T): Promise<T> {
		const res = await couchReq('PUT', `/${SHELTER_CLOSE_DB}/${enc(doc._id)}`, doc);
		if (res.status === 409) throw new ShelterCloseJobConflictError(doc._id);
		if (res.status >= 300) throw new Error(`Could not write ${doc._id} (${res.status})`);
		return { ...doc, _rev: (res.data as { rev?: string })?.rev ?? doc._rev };
	}

	async function deleteDoc(id: string, rev: string): Promise<void> {
		const res = await couchReq('DELETE', `/${SHELTER_CLOSE_DB}/${enc(id)}?rev=${enc(rev)}`);
		// 404 / 409: someone else already removed or replaced it.
		if (res.status >= 400 && res.status !== 404 && res.status !== 409) {
			throw new Error(`Could not delete ${id} (${res.status})`);
		}
	}

	const getJobById = (id: string) => getDoc<ShelterCloseJob>(id);

	/** Looks a job up by the API id (bare ulid) or full `_id`. */
	const getJob = (id: string) =>
		getDoc<ShelterCloseJob>(
			id.startsWith(SHELTER_CLOSE_JOB_PREFIX) ? id : `${SHELTER_CLOSE_JOB_PREFIX}${id}`
		);

	// ---------------------------------------------------------------- lock (FR-2, FR-3, FR-3a)

	/** Deletes the lock for `code` if it is still held by `jobId` (CAS on the lock `_rev`). */
	async function releaseLock(code: string, jobId: string): Promise<void> {
		const lock = await getDoc<ShelterCloseLock>(shelterCloseLockId(code));
		if (lock?._rev && lock.job_id === jobId) await deleteDoc(lock._id, lock._rev);
	}

	/**
	 * FR-3a: the active job of a shelter, or null. A lock pointing at a terminal or missing job
	 * is deleted; an active job whose `updated_at` is older than `staleMs` is closed as
	 * `completed_with_errors` / `stale` (CAS on the job `_rev` — if a worker moved it meanwhile
	 * the job is returned as still active) and its lock released.
	 */
	async function getActiveJob(code: string): Promise<ShelterCloseJob | null> {
		await ensureDesign();
		const lock = await getDoc<ShelterCloseLock>(shelterCloseLockId(code));
		if (!lock) return null;
		const job = await getJobById(lock.job_id);
		if (!job || isTerminalShelterCloseJob(job)) {
			if (lock._rev) await deleteDoc(lock._id, lock._rev);
			return null;
		}
		const age = nowMs() - Date.parse(job.updated_at);
		if (age > config.staleMs) {
			try {
				await putDoc<ShelterCloseJob>({
					...job,
					status: 'completed_with_errors',
					phase: 'done',
					end_reason: 'stale',
					lease_owner: undefined,
					lease_until: undefined,
					finished_at: iso(),
					updated_at: iso()
				});
			} catch (err) {
				if (err instanceof ShelterCloseJobConflictError) return job; // worker is alive
				throw err;
			}
			if (lock._rev) await deleteDoc(lock._id, lock._rev);
			return null;
		}
		return job;
	}

	// ---------------------------------------------------------------- create (FR-6, FR-7, FR-10)

	/**
	 * Creates a queued job and takes the shelter lock (CAS: the lock doc is created without
	 * `_rev`, so only one creator wins). The job is written first and the lock second — a worker
	 * only claims a job whose lock points at it — so a lost race just deletes the unclaimed job.
	 */
	async function createJob(input: {
		shelter_code: string;
		mode: ShelterCloseJobMode;
		requested_by: string;
		preview: ShelterClosePreview;
	}): Promise<CreateShelterCloseJobResult> {
		const existing = await getActiveJob(input.shelter_code);
		if (existing) return { created: false, job_id: existing.job_ulid };

		const job_ulid = newUlid();
		const at = iso();
		const job: ShelterCloseJob = {
			_id: `${SHELTER_CLOSE_JOB_PREFIX}${job_ulid}`,
			type: 'shelter_close_job',
			schema_v: 1,
			job_ulid,
			shelter_code: input.shelter_code.toUpperCase(),
			mode: input.mode,
			requested_by: input.requested_by,
			status: 'queued',
			phase: 'people',
			cursor: {},
			sweep_round: 0,
			counters: { checked_out: 0, cancelled: 0, households_repaired: 0, failed: 0 },
			preview: input.preview,
			failures: [],
			attempt: 0,
			created_at: at,
			updated_at: at,
			closed: false
		};
		const saved = await putDoc(job);
		const lockDoc: ShelterCloseLock = {
			_id: shelterCloseLockId(input.shelter_code),
			type: 'shelter_close_lock',
			schema_v: 1,
			shelter_code: job.shelter_code,
			job_id: job._id,
			created_at: at
		};
		try {
			await putDoc(lockDoc);
		} catch (err) {
			if (saved._rev) await deleteDoc(saved._id, saved._rev).catch(() => undefined);
			if (err instanceof ShelterCloseJobConflictError) {
				const winner = await getActiveJob(input.shelter_code);
				if (winner) return { created: false, job_id: winner.job_ulid };
			}
			throw err;
		}
		return { created: true, job: saved };
	}

	// ---------------------------------------------------------------- claim (FR-12..FR-14)

	async function queryView(
		startkey: unknown[],
		endkey: unknown[],
		limit = 25
	): Promise<ShelterCloseJob[]> {
		const qs =
			`startkey=${enc(JSON.stringify(startkey))}&endkey=${enc(JSON.stringify(endkey))}` +
			`&include_docs=true&limit=${limit}`;
		const res = await couchReq(
			'GET',
			`/${SHELTER_CLOSE_DB}/${SHELTER_CLOSE_DESIGN_ID}/_view/${SHELTER_CLOSE_VIEW}?${qs}`
		);
		if (res.status >= 400) throw new Error(`Could not read ${SHELTER_CLOSE_VIEW} (${res.status})`);
		const rows = (res.data as { rows?: { doc?: ShelterCloseJob }[] })?.rows ?? [];
		return rows.map((r) => r.doc).filter((d): d is ShelterCloseJob => !!d);
	}

	/** Terminal write of a job, then release of its lock (FR-3). */
	async function finishJob(
		job: ShelterCloseJob,
		patch: Partial<ShelterCloseJob> & {
			status: 'completed' | 'completed_with_errors';
			end_reason: ShelterCloseEndReason;
		}
	): Promise<ShelterCloseJob> {
		const at = iso();
		const saved = await putDoc<ShelterCloseJob>({
			...job,
			...patch,
			phase: 'done',
			lease_owner: undefined,
			lease_until: undefined,
			finished_at: at,
			updated_at: at
		});
		await releaseLock(job.shelter_code, job._id);
		return saved;
	}

	/** `true` when the shelter lock points at this job (a worker never works an unlocked job). */
	async function holdsLock(job: ShelterCloseJob): Promise<boolean> {
		const lock = await getDoc<ShelterCloseLock>(shelterCloseLockId(job.shelter_code));
		return lock?.job_id === job._id;
	}

	/**
	 * Claim or continue one job for `workerId`. Order: own running job (lease renewed) →
	 * running job whose lease expired (taken over, `attempt + 1`, or ended `attempts_exhausted`
	 * past `maxAttempts`) → oldest queued job (`attempt = 1`). The claim is a CAS write that
	 * also renews the lease (FR-13: lease before cursor); a lost CAS skips to the next candidate.
	 */
	async function claimNext(workerId: string): Promise<ShelterCloseJob | null> {
		await ensureDesign();
		const nowIso = iso();
		const running = await queryView(['running'], ['running', {}]);
		const own = running.filter((j) => j.lease_owner === workerId);
		const expired = running.filter(
			(j) => j.lease_owner !== workerId && (j.lease_until ?? j.created_at) <= nowIso
		);
		const queued = await queryView(['queued'], ['queued', {}]);
		const candidates: { job: ShelterCloseJob; takeover: boolean }[] = [
			...own.map((job) => ({ job, takeover: false })),
			...expired.map((job) => ({ job, takeover: true })),
			...queued.map((job) => ({ job, takeover: false }))
		];
		for (const { job, takeover } of candidates) {
			try {
				if (!(await holdsLock(job))) continue;
				if (takeover && job.attempt >= config.maxAttempts) {
					await finishJob(job, {
						status: 'completed_with_errors',
						end_reason: 'attempts_exhausted'
					});
					continue;
				}
				const at = iso();
				return await putDoc<ShelterCloseJob>({
					...job,
					status: 'running',
					lease_owner: workerId,
					lease_until: iso(nowMs() + config.leaseMs),
					attempt: job.status === 'queued' || takeover ? job.attempt + 1 : job.attempt,
					started_at: job.started_at ?? at,
					updated_at: at
				});
			} catch (err) {
				if (err instanceof ShelterCloseJobConflictError) continue;
				throw err;
			}
		}
		return null;
	}

	/**
	 * Persist a chunk's progress (cursor / counters / phase …), bump `updated_at` and extend the
	 * lease. On `409` the job is re-read (FR-13): terminal or owned by another worker -> returns
	 * `null` (stop, do not overwrite); still ours -> one retry on the fresh `_rev`.
	 */
	async function saveProgress(
		job: ShelterCloseJob,
		patch: Partial<ShelterCloseJob>,
		workerId: string
	): Promise<ShelterCloseJob | null> {
		const write = (base: ShelterCloseJob) =>
			putDoc<ShelterCloseJob>({
				...base,
				...patch,
				lease_owner: workerId,
				lease_until: iso(nowMs() + config.leaseMs),
				updated_at: iso()
			});
		try {
			return await write(job);
		} catch (err) {
			if (!(err instanceof ShelterCloseJobConflictError)) throw err;
		}
		const fresh = await getJobById(job._id);
		if (!fresh || isTerminalShelterCloseJob(fresh) || fresh.lease_owner !== workerId) return null;
		try {
			return await write(fresh);
		} catch (err) {
			if (err instanceof ShelterCloseJobConflictError) return null;
			throw err;
		}
	}

	/** Same stop rule as {@link saveProgress} for the terminal write. */
	async function finishOwnedJob(
		job: ShelterCloseJob,
		patch: Parameters<typeof finishJob>[1],
		workerId: string
	): Promise<ShelterCloseJob | null> {
		try {
			return await finishJob(job, patch);
		} catch (err) {
			if (!(err instanceof ShelterCloseJobConflictError)) throw err;
		}
		const fresh = await getJobById(job._id);
		if (!fresh || isTerminalShelterCloseJob(fresh) || fresh.lease_owner !== workerId) return null;
		try {
			return await finishJob(fresh, patch);
		} catch (err) {
			if (err instanceof ShelterCloseJobConflictError) return null;
			throw err;
		}
	}

	/**
	 * Give the lease up after a failed chunk (ownerless, already expired): any worker may take
	 * the job over, which counts as an attempt (FR-14) so a poisoned job ends `attempts_exhausted`.
	 */
	async function abandonLease(job: ShelterCloseJob): Promise<void> {
		try {
			await putDoc<ShelterCloseJob>({
				...job,
				lease_owner: undefined,
				lease_until: iso(),
				updated_at: iso()
			});
		} catch (err) {
			if (!(err instanceof ShelterCloseJobConflictError)) throw err;
		}
	}

	return {
		config,
		ensureDesign,
		abandonLease,
		createJob,
		getActiveJob,
		getJob,
		claimNext,
		saveProgress,
		finishJob,
		finishOwnedJob,
		releaseLock
	};
}
