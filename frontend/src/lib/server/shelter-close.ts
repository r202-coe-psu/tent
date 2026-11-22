/**
 * Shelter close — check out / cancel everyone still on a stay in the shelter
 * database (CR-219 FR-9..FR-14, backfill FR-28..FR-31).
 *
 * Deliberately free of `$env` and `@sveltejs/kit` so `scripts/migrate-closed-shelter-checkout.ts`
 * runs the same code as the route; Couch HTTP is injected as `couchReq` (admin).
 *
 * Writes go through the people domain (`buildShelterCloseCheckout` → `applyMovementToStay`,
 * `deriveShelterCloseHousehold` → `deriveHouseholdStatus`) — never a direct status set.
 * Per chunk the order is evacuees → movements of the evacuees that saved → cancel audits →
 * households. A household's members are kept in one chunk so it is derived once. After the
 * last chunk, every household whose stored status no longer matches its members is re-derived,
 * so a re-run repairs households an earlier, interrupted run left behind.
 *
 * Registry write (`operation_status = closed`) is the caller's job, after
 * {@link closeShelterPeople} reports zero failures and zero remaining (FR-13).
 */

import type { AuthorContext } from '$lib/db/model';
import {
	buildShelterCloseCancel,
	buildShelterCloseCancelAudit,
	buildShelterCloseCheckout,
	deriveShelterCloseHousehold,
	isShelterCloseAffectedStatus,
	isShelterCloseCancelStatus,
	type Evacuee,
	type Household,
	type Movement,
	type StayStatus
} from '$lib/features/people/server';
import type {
	ShelterCloseEndReason,
	ShelterCloseJobCounters,
	ShelterCloseJobCursor,
	ShelterCloseJobFailure,
	ShelterCloseJobMode,
	ShelterCloseJobPhase as ShelterCloseJobPhaseT,
	ShelterClosePreview
} from '$lib/features/shelters/server';
import type { CouchReq } from './ensure-public-writer';
import { shelterDbName } from './shelter-access-design';

/** FR-10: at most this many docs per `_bulk_docs` call. */
export const SHELTER_CLOSE_CHUNK_SIZE = 200;
/** FR-11: re-fetch + retry a conflicting doc at most this many times. */
export const SHELTER_CLOSE_MAX_RETRIES = 3;
const PAGE_SIZE = 1000;

export interface ShelterCloseFailure {
	evacuee_id: string;
	error: string;
}

export interface ShelterCloseRun {
	checked_out: number;
	cancelled: number;
	/**
	 * Households whose stored status no longer matched their members and were re-derived after
	 * the chunks — the repair of an earlier, interrupted run (FR-12a). 0 on a clean run.
	 */
	households_repaired: number;
	failed: ShelterCloseFailure[];
	/** FR-13 re-count after the writes — must be `total = 0` before the registry is closed. */
	remaining: ShelterClosePreview;
}

export interface ShelterCloseOptions {
	/** Author of movements / audits (FR-4: the person closing the shelter). */
	createdBy: string;
	/** Extra audit `context` (backfill FR-30). */
	auditContext?: Record<string, unknown>;
	/** Clock for tests. */
	now?: () => string;
}

type BulkRow = { id?: string; rev?: string; ok?: boolean; error?: string; reason?: string };

// ------------------------------------------------------------------ reads

async function listEvacuees(couchReq: CouchReq, db: string): Promise<Evacuee[]> {
	const out: Evacuee[] = [];
	let startkey = 'evacuee:';
	let skip = 0;
	for (;;) {
		const qs =
			`startkey=${encodeURIComponent(JSON.stringify(startkey))}` +
			`&endkey=${encodeURIComponent(JSON.stringify('evacuee:￰'))}` +
			`&include_docs=true&limit=${PAGE_SIZE}&skip=${skip}`;
		const res = await couchReq('GET', `/${db}/_all_docs?${qs}`);
		if (res.status === 404) throw new Error(`Shelter database ${db} not found`);
		if (res.status >= 400) throw new Error(`Could not read evacuees of ${db} (${res.status})`);
		const rows = (res.data as { rows?: { id: string; doc?: Evacuee }[] })?.rows ?? [];
		for (const row of rows) {
			if (row.doc?.type === 'evacuee') out.push(row.doc);
		}
		if (rows.length < PAGE_SIZE) return out;
		// Resume after the last key instead of a growing skip.
		startkey = rows[rows.length - 1].id;
		skip = 1;
	}
}

async function getDocs<T>(couchReq: CouchReq, db: string, ids: readonly string[]): Promise<T[]> {
	if (ids.length === 0) return [];
	const res = await couchReq('POST', `/${db}/_all_docs?include_docs=true`, { keys: ids });
	if (res.status >= 400) throw new Error(`Could not read docs of ${db} (${res.status})`);
	const rows = (res.data as { rows?: { doc?: T | null }[] })?.rows ?? [];
	return rows.map((r) => r.doc).filter((d): d is T => !!d);
}

async function getDoc<T>(couchReq: CouchReq, db: string, id: string): Promise<T | null> {
	const res = await couchReq('GET', `/${db}/${encodeURIComponent(id)}`);
	if (res.status === 404) return null;
	if (res.status >= 400) throw new Error(`Could not read ${id} (${res.status})`);
	return res.data as T;
}

async function bulkDocs(
	couchReq: CouchReq,
	db: string,
	docs: readonly unknown[]
): Promise<BulkRow[]> {
	const res = await couchReq('POST', `/${db}/_bulk_docs`, { docs });
	if (res.status >= 400) throw new Error(`_bulk_docs failed on ${db} (${res.status})`);
	return (res.data as BulkRow[]) ?? [];
}

/** Marks a row whose whole `_bulk_docs` request failed (HTTP error or network). */
const REQUEST_FAILED = 'request_failed';

/**
 * `_bulk_docs` that never throws: a failed request becomes one `request_failed` row per doc, so
 * every writer handles it like a row error (retry / roll back / report) instead of aborting the
 * run halfway — CouchDB may still have committed the request, which the callers check.
 */
async function bulkDocsRows(
	couchReq: CouchReq,
	db: string,
	docs: readonly unknown[]
): Promise<BulkRow[]> {
	try {
		return await bulkDocs(couchReq, db, docs);
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		return docs.map(() => ({ error: REQUEST_FAILED, reason }));
	}
}

/** Errors worth re-reading the doc and trying again for. */
const isRetryable = (row: BulkRow | undefined) =>
	row?.error === 'conflict' || row?.error === REQUEST_FAILED;

function rowError(row: BulkRow | undefined): string {
	if (!row) return 'no result from _bulk_docs';
	return [row.error, row.reason].filter(Boolean).join(': ') || 'unknown error';
}

function chunk<T>(items: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

// ------------------------------------------------------------------ preview

/** FR-7: count people the close would change, by stay status (live read). */
export function countShelterClose(evacuees: readonly Evacuee[]): ShelterClosePreview {
	const by_status: Partial<Record<StayStatus, number>> = {};
	let total = 0;
	for (const e of evacuees) {
		const status = e.current_stay?.status;
		if (!status || !isShelterCloseAffectedStatus(status)) continue;
		by_status[status] = (by_status[status] ?? 0) + 1;
		total += 1;
	}
	return { by_status, total };
}

/**
 * FR-7 counts from the `occupancy` view (`_count` per `current_stay.status`) — a few rows
 * instead of every evacuee doc. Views are brought up to date on read, so a count right after
 * this run's writes is exact. Falls back to scanning the evacuees when the view is not
 * deployed (404) in this shelter DB; any other error is raised, not hidden.
 */
export async function previewShelterClose(
	couchReq: CouchReq,
	code: string
): Promise<ShelterClosePreview> {
	const db = shelterDbName(code);
	const res = await couchReq('GET', `/${db}/_design/app/_view/occupancy?group=true`);
	if (res.status === 404) return countShelterClose(await listEvacuees(couchReq, db));
	if (res.status !== 200) throw new Error(`Could not read occupancy of ${db} (${res.status})`);
	const rows = (res.data as { rows?: { key: unknown; value: unknown }[] })?.rows ?? [];
	const by_status: Partial<Record<StayStatus, number>> = {};
	let total = 0;
	for (const { key, value } of rows) {
		if (typeof key !== 'string' || typeof value !== 'number' || value <= 0) continue;
		if (!isShelterCloseAffectedStatus(key as StayStatus)) continue;
		by_status[key as StayStatus] = value;
		total += value;
	}
	return { by_status, total };
}

/**
 * A household the stale pass would re-derive: its members' derived status differs from the
 * stored one. Returns the doc to write, or `null` (also for a household with no members found,
 * so moved-away members never cancel it). A household checked out by hand without a destination
 * already matches, so it is never relabelled `shelter_closed`.
 */
function staleHouseholdNext(household: Household, memberStatuses: readonly StayStatus[]) {
	if (memberStatuses.length === 0) return null;
	const next = deriveShelterCloseHousehold(household, memberStatuses);
	return next && next.status !== household.status ? next : null;
}

function statusesByHousehold(evacuees: readonly Evacuee[]): Map<string, StayStatus[]> {
	const out = new Map<string, StayStatus[]>();
	for (const e of evacuees) {
		const status = e.current_stay?.status;
		if (!e.household_id || !status) continue;
		out.set(e.household_id, [...(out.get(e.household_id) ?? []), status]);
	}
	return out;
}

/**
 * Dry-run count of households a close would repair (FR-31a; the FR-12a repair): those
 * whose stored status no longer matches members that are already closed out. Households with a
 * member still affected are left to the main run, which derives them anyway.
 */
export async function countStaleHouseholds(couchReq: CouchReq, code: string): Promise<number> {
	const db = shelterDbName(code);
	const byHousehold = statusesByHousehold(await listEvacuees(couchReq, db));
	const settled = [...byHousehold].filter(
		([, statuses]) => !statuses.some((status) => isShelterCloseAffectedStatus(status))
	);
	let count = 0;
	for (const ids of chunk(
		settled.map(([hh]) => hh),
		SHELTER_CLOSE_CHUNK_SIZE
	)) {
		for (const hh of await getDocs<Household>(couchReq, db, ids)) {
			if (staleHouseholdNext(hh, byHousehold.get(hh._id) ?? [])) count += 1;
		}
	}
	return count;
}

// ------------------------------------------------------------------ writes

/**
 * Group affected evacuees into chunks of ≤ `size`, never splitting a household
 * across chunks unless the household alone is larger than `size`.
 */
export function chunkByHousehold(evacuees: readonly Evacuee[], size: number): Evacuee[][] {
	const groups = new Map<string, Evacuee[]>();
	for (const e of evacuees) {
		const key = e.household_id ?? `solo:${e._id}`;
		const list = groups.get(key);
		if (list) list.push(e);
		else groups.set(key, [e]);
	}
	const chunks: Evacuee[][] = [];
	let current: Evacuee[] = [];
	for (const group of groups.values()) {
		if (current.length > 0 && current.length + group.length > size) {
			chunks.push(current);
			current = [];
		}
		if (group.length > size) {
			chunks.push(...chunk(group, size));
			continue;
		}
		current.push(...group);
	}
	if (current.length > 0) chunks.push(current);
	return chunks;
}

/** A planned write; `before` is the doc as read, kept so a check-out can be rolled back. */
type Planned =
	| { kind: 'checkout'; evacuee: Evacuee; movement: Movement; before: Evacuee }
	| { kind: 'cancel'; evacuee: Evacuee; before: Evacuee };

function plan(evacuee: Evacuee, ctx: AuthorContext, at: string): Planned | null {
	const status = evacuee.current_stay?.status;
	if (!status || !isShelterCloseAffectedStatus(status)) return null; // FR-12: already closed out
	if (isShelterCloseCancelStatus(status)) {
		return { kind: 'cancel', evacuee: buildShelterCloseCancel(evacuee, at), before: evacuee };
	}
	const { evacuee: next, movement } = buildShelterCloseCheckout(evacuee, ctx, at);
	return { kind: 'checkout', evacuee: next, movement, before: evacuee };
}

/**
 * Write one evacuee chunk. A failed row is re-read: if it already holds this run's write (a
 * request whose response was lost), it counts as saved so it still gets its movement; if it is
 * still affected after a 409 / failed request it is re-planned and retried up to
 * {@link SHELTER_CLOSE_MAX_RETRIES} times (FR-11); if someone else already closed it out it is
 * dropped; anything else is reported.
 */
async function writeEvacuees(
	couchReq: CouchReq,
	db: string,
	planned: Planned[],
	ctx: AuthorContext,
	at: string,
	failed: ShelterCloseFailure[]
): Promise<Planned[]> {
	const saved: Planned[] = [];
	let pending = planned;
	for (let attempt = 0; pending.length > 0; attempt++) {
		const rows = await bulkDocsRows(
			couchReq,
			db,
			pending.map((p) => p.evacuee)
		);
		const retry: Planned[] = [];
		for (const [i, p] of pending.entries()) {
			const row = rows[i];
			if (row?.ok) {
				saved.push({ ...p, evacuee: { ...p.evacuee, _rev: row.rev } });
				continue;
			}
			let latest: Evacuee | null;
			try {
				latest = await getDoc<Evacuee>(couchReq, db, p.evacuee._id);
			} catch (err) {
				const why = err instanceof Error ? err.message : String(err);
				failed.push({ evacuee_id: p.evacuee._id, error: `${rowError(row)}; re-read: ${why}` });
				continue;
			}
			const ours =
				latest?.current_stay?.since === at &&
				latest.current_stay.status === p.evacuee.current_stay.status;
			if (latest && ours) {
				saved.push({ ...p, evacuee: latest });
				continue;
			}
			const next = latest ? plan(latest, ctx, at) : null;
			if (!next) continue; // closed out by someone else meanwhile
			if (isRetryable(row) && attempt < SHELTER_CLOSE_MAX_RETRIES) retry.push(next);
			else failed.push({ evacuee_id: p.evacuee._id, error: rowError(row) });
		}
		pending = retry;
	}
	return saved;
}

/**
 * Write append-only docs (movements, audits) with ids minted for this run. A failed row or
 * request is retried; a 409 means an earlier attempt whose response was lost already stored
 * that `_id`, so it counts as written. Returns `_id → last error` for docs still unwritten.
 */
async function writeNewDocs(
	couchReq: CouchReq,
	db: string,
	docs: readonly { _id: string }[]
): Promise<Map<string, string>> {
	const unwritten = new Map<string, string>();
	let pending = docs;
	for (let attempt = 0; pending.length > 0; attempt++) {
		const rows = await bulkDocsRows(couchReq, db, pending);
		const retry: { _id: string }[] = [];
		for (const [i, doc] of pending.entries()) {
			const row = rows[i];
			if (row?.ok || row?.error === 'conflict') continue;
			if (attempt < SHELTER_CLOSE_MAX_RETRIES) retry.push(doc);
			else unwritten.set(doc._id, rowError(row));
		}
		pending = retry;
	}
	return unwritten;
}

/** Movements of this chunk; returns `evacuee_id → error` for those still unwritten. */
async function writeMovements(
	couchReq: CouchReq,
	db: string,
	movements: Movement[]
): Promise<Map<string, string>> {
	const unwritten = await writeNewDocs(couchReq, db, movements);
	return new Map(
		movements.filter((m) => unwritten.has(m._id)).map((m) => [m.evacuee_id, unwritten.get(m._id)!])
	);
}

/**
 * A check-out whose movement could not be written must not stay `checked_out`: a re-run skips
 * closed-out people (FR-12), so it would never get its movement and the audit trail would have a
 * hole. Put the stay back as it was read, so the person is still affected and a re-run closes
 * them out properly. 409s are re-fetched; a doc someone else changed since is left alone.
 * Returns the ids that were restored.
 */
async function rollbackCheckouts(
	couchReq: CouchReq,
	db: string,
	checkouts: Planned[],
	at: string,
	now: () => string
): Promise<Set<string>> {
	const restored = new Set<string>();
	const restore = (current: Evacuee, before: Evacuee): Evacuee => ({
		...current,
		current_stay: before.current_stay,
		updated_at: now()
	});
	let pending = checkouts.map((p) => ({ before: p.before, doc: restore(p.evacuee, p.before) }));
	for (let attempt = 0; pending.length > 0; attempt++) {
		const rows = await bulkDocsRows(
			couchReq,
			db,
			pending.map((p) => p.doc)
		);
		const retry: typeof pending = [];
		for (const [i, p] of pending.entries()) {
			const row = rows[i];
			if (row?.ok) {
				restored.add(p.doc._id);
				continue;
			}
			if (!isRetryable(row) || attempt >= SHELTER_CLOSE_MAX_RETRIES) continue;
			const latest = await getDoc<Evacuee>(couchReq, db, p.doc._id).catch(() => null);
			// A lost response may hide a rollback that did land.
			if (latest && latest.current_stay?.since === p.before.current_stay.since) {
				if (latest.current_stay.status === p.before.current_stay.status) {
					restored.add(p.doc._id);
					continue;
				}
			}
			// Only undo our own write: still checked out at this run's instant.
			if (latest?.current_stay?.status === 'checked_out' && latest.current_stay.since === at) {
				retry.push({ before: p.before, doc: restore(latest, p.before) });
			}
		}
		pending = retry;
	}
	return restored;
}

/**
 * Re-derive `householdIds` from their members as they are now (FR-5, FR-6b). Member statuses
 * are read fresh (by id, one request) so a member changed by someone else during the run is
 * derived from its current stay, not the snapshot taken when the run started. `memberIds` maps
 * household → member ids from that snapshot; `reportAs` names the evacuee a failure is filed
 * under. With `staleOnly`, a household is written only when its derived status differs from the
 * stored one (see {@link staleHouseholdNext}). Returns the households that could not be derived
 * (already added to `failed`) and how many were written.
 */
async function deriveHouseholds(
	couchReq: CouchReq,
	db: string,
	householdIds: readonly string[],
	memberIds: Map<string, string[]>,
	reportAs: (householdId: string) => string,
	failed: ShelterCloseFailure[],
	staleOnly = false
): Promise<{ unresolved: Set<string>; written: number }> {
	const unresolved = new Set<string>();
	let written = 0;
	const fail = (hh: string, error: string) => {
		unresolved.add(hh);
		failed.push({ evacuee_id: reportAs(hh), error: `household ${hh}: ${error}` });
	};
	let pending = [...householdIds];
	for (let attempt = 0; pending.length > 0; attempt++) {
		const last = attempt >= SHELTER_CLOSE_MAX_RETRIES;
		let households: Household[];
		let fresh: Evacuee[];
		try {
			households = await getDocs<Household>(couchReq, db, pending);
			fresh = await getDocs<Evacuee>(
				couchReq,
				db,
				pending.flatMap((hh) => memberIds.get(hh) ?? [])
			);
		} catch (err) {
			if (!last) continue;
			const why = err instanceof Error ? err.message : String(err);
			for (const hh of pending) fail(hh, why);
			return { unresolved, written };
		}
		const statusesOf = (householdId: string) =>
			fresh
				.filter((m) => m.household_id === householdId && m.current_stay?.status)
				.map((m) => m.current_stay.status);
		const writes: Household[] = [];
		for (const hh of households) {
			const statuses = statusesOf(hh._id);
			const next = staleOnly
				? staleHouseholdNext(hh, statuses)
				: deriveShelterCloseHousehold(hh, statuses);
			if (next) writes.push(next);
		}
		if (writes.length === 0) return { unresolved, written };
		const rows = await bulkDocsRows(couchReq, db, writes);
		const retry: string[] = [];
		for (const [i, hh] of writes.entries()) {
			const row = rows[i];
			if (row?.ok) {
				written += 1;
				continue;
			}
			if (isRetryable(row) && !last) retry.push(hh._id);
			else fail(hh._id, rowError(row));
		}
		pending = retry;
	}
	return { unresolved, written };
}

/**
 * Add one cancel audit per household with cancelled members (FR-6a), then re-derive every
 * household touched by the chunk. Returns the households that could not be derived.
 */
async function writeHouseholds(
	couchReq: CouchReq,
	db: string,
	saved: Planned[],
	memberIds: Map<string, string[]>,
	ctx: AuthorContext,
	auditContext: Record<string, unknown>,
	failed: ShelterCloseFailure[]
): Promise<Set<string>> {
	const cancelledBy = new Map<string, string[]>();
	const memberOf = new Map<string, string>();
	for (const p of saved) {
		const hh = p.evacuee.household_id;
		if (!hh) continue;
		if (!memberOf.has(hh)) memberOf.set(hh, p.evacuee._id);
		if (p.kind === 'cancel') cancelledBy.set(hh, [...(cancelledBy.get(hh) ?? []), p.evacuee._id]);
	}
	const audits = [...cancelledBy].map(([hh, ids]) =>
		buildShelterCloseCancelAudit(hh, ids, ctx, auditContext)
	);

	// FR-6a first and on its own: the members are already `cancelled`, so a re-run will not
	// come back for them — the audit must not hang on the household reads below.
	const unwrittenAudits = await writeNewDocs(couchReq, db, audits);
	for (const audit of audits) {
		const error = unwrittenAudits.get(audit._id);
		if (error === undefined) continue;
		failed.push({
			evacuee_id: memberOf.get(audit.target_id) ?? audit.target_id,
			error: `audit ${audit.target_id}: ${error}`
		});
	}

	const { unresolved } = await deriveHouseholds(
		couchReq,
		db,
		[...memberOf.keys()],
		memberIds,
		(hh) => memberOf.get(hh) ?? hh,
		failed
	);
	return unresolved;
}

/**
 * FR-31/FR-32 dry-run: counts only, nothing is written. Same reads as the step function's
 * `people` / `households` phases would act on.
 */
export async function dryRunShelterClose(
	couchReq: CouchReq,
	code: string
): Promise<{ preview: ShelterClosePreview; stale_households: number }> {
	const preview = await previewShelterClose(couchReq, code);
	const stale_households = await countStaleHouseholds(couchReq, code);
	return { preview, stale_households };
}

// ------------------------------------------------------------------ step function (CR-243 FR-26)

/** CR-243 FR-19: a job restarts `people` at most this many times after a non-empty re-count. */
export const SHELTER_CLOSE_MAX_SWEEPS = 3;

const sortKey = (e: Evacuee) => `${e.household_id ?? `solo:${e._id}`}\u0000${e._id}`;
const groupKey = (e: Evacuee) => e.household_id ?? `solo:${e._id}`;

/**
 * Next chunk (≤ `size`) of affected evacuees strictly after `after` in (household, id) order. A
 * household stays in one chunk unless it alone exceeds `size`. `cursor` is the sort key of the
 * last evacuee taken, `null` when nothing is left. Failed people stay behind the cursor, so a
 * chunk is never retried inside one round.
 */
export function nextPeopleChunk(
	affected: readonly Evacuee[],
	after: string | null | undefined,
	size: number
): { chunk: Evacuee[]; cursor: string | null } {
	const sorted = affected
		.map((e) => ({ e, k: sortKey(e) }))
		.filter((x) => after == null || x.k > after)
		.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
	const groups: { e: Evacuee; k: string }[][] = [];
	for (const item of sorted) {
		const last = groups[groups.length - 1];
		if (last && groupKey(last[0].e) === groupKey(item.e)) last.push(item);
		else groups.push([item]);
	}
	let taken: { e: Evacuee; k: string }[] = [];
	for (const group of groups) {
		if (taken.length > 0 && taken.length + group.length > size) break;
		if (group.length > size) {
			taken = group.slice(0, size);
			break;
		}
		taken = taken.concat(group);
	}
	return {
		chunk: taken.map((x) => x.e),
		cursor: taken.length > 0 ? taken[taken.length - 1].k : null
	};
}

export type ShelterCloseJobPhase = ShelterCloseJobPhaseT;

export interface ShelterCloseStepState {
	phase: ShelterCloseJobPhase;
	cursor: ShelterCloseJobCursor;
	sweep_round: number;
	counters: ShelterCloseJobCounters;
	failures: ShelterCloseJobFailure[];
}

export const initialShelterCloseStepState = (): ShelterCloseStepState => ({
	phase: 'people',
	cursor: {},
	sweep_round: 0,
	counters: { checked_out: 0, cancelled: 0, households_repaired: 0, failed: 0 },
	failures: []
});

export interface ShelterCloseStepOptions {
	/** Author of movements / audits — the job's `requested_by` (FR-10a). */
	createdBy: string;
	mode?: ShelterCloseJobMode;
	/** Extra audit `context` (backfill FR-30). */
	auditContext?: Record<string, unknown>;
	now?: () => string;
	/** Instant stamped on this chunk's stays; defaults to `now()`. */
	at?: string;
	/** Cap on `failures[]` (FR-24); `counters.failed` keeps counting. Default unbounded. */
	maxFailures?: number;
	/** Evacuees already read (the one-shot wrapper reads once); default: read on every step. */
	evacuees?: Evacuee[];
	/**
	 * `finalize` phase (FR-20/FR-21), called after a clean re-count. `close` mode is called only
	 * when no one failed; `backfill` always (its audit records failures). Returns whether the
	 * registry was closed by this job.
	 */
	finalize?: (state: ShelterCloseStepState) => Promise<{ closed: boolean }>;
}

export interface ShelterCloseStepOutcome {
	status: 'completed' | 'completed_with_errors';
	end_reason: ShelterCloseEndReason;
	closed: boolean;
}

export interface ShelterCloseStepResult {
	state: ShelterCloseStepState;
	/** Set when the job reached `done`; the caller persists the terminal status. */
	outcome: ShelterCloseStepOutcome | null;
}

function withFailures(
	state: ShelterCloseStepState,
	failed: readonly ShelterCloseFailure[],
	max: number
): ShelterCloseStepState {
	if (failed.length === 0) return state;
	const room = Math.max(0, max - state.failures.length);
	return {
		...state,
		counters: { ...state.counters, failed: state.counters.failed + failed.length },
		failures: [...state.failures, ...failed.slice(0, room)]
	};
}

async function readSnapshot(couchReq: CouchReq, db: string, options: ShelterCloseStepOptions) {
	const evacuees = options.evacuees ?? (await listEvacuees(couchReq, db));
	const memberIds = new Map<string, string[]>();
	for (const e of evacuees) {
		if (!e.household_id) continue;
		memberIds.set(e.household_id, [...(memberIds.get(e.household_id) ?? []), e._id]);
	}
	return { evacuees, memberIds };
}

async function peopleStep(
	couchReq: CouchReq,
	code: string,
	state: ShelterCloseStepState,
	options: ShelterCloseStepOptions
): Promise<ShelterCloseStepState> {
	const db = shelterDbName(code);
	const now = options.now ?? (() => new Date().toISOString());
	const at = options.at ?? now();
	const max = options.maxFailures ?? Number.POSITIVE_INFINITY;
	const ctx: AuthorContext = { shelterCode: code.toUpperCase(), createdBy: options.createdBy };
	const { evacuees, memberIds } = await readSnapshot(couchReq, db, options);
	const affected = evacuees.filter(
		(e) => e.current_stay?.status && isShelterCloseAffectedStatus(e.current_stay.status)
	);
	const { chunk: group, cursor } = nextPeopleChunk(
		affected,
		state.cursor.after,
		SHELTER_CLOSE_CHUNK_SIZE
	);
	if (group.length === 0) {
		return { ...state, phase: 'households', cursor: { reported: state.cursor.reported } };
	}

	const failed: ShelterCloseFailure[] = [];
	const planned: Planned[] = [];
	for (const e of group) {
		try {
			const p = plan(e, ctx, at);
			if (p) planned.push(p);
		} catch (err) {
			failed.push({ evacuee_id: e._id, error: err instanceof Error ? err.message : String(err) });
		}
	}

	const written = await writeEvacuees(couchReq, db, planned, ctx, at, failed);
	const unwritten = await writeMovements(
		couchReq,
		db,
		written.flatMap((p) => (p.kind === 'checkout' ? [p.movement] : []))
	);
	const orphaned = written.filter((p) => unwritten.has(p.evacuee._id));
	const restored = await rollbackCheckouts(couchReq, db, orphaned, at, now);
	for (const p of orphaned) {
		const why = `movement: ${unwritten.get(p.evacuee._id)}`;
		failed.push({
			evacuee_id: p.evacuee._id,
			error: restored.has(p.evacuee._id)
				? `${why} — stay restored, close again to retry`
				: `${why} — stay NOT restored: checked out without a movement`
		});
	}
	// Rolled-back people were not closed out; everyone else in `written` was.
	const saved = written.filter((p) => !restored.has(p.evacuee._id));
	let checked_out = 0;
	let cancelled = 0;
	for (const p of saved) {
		if (p.kind === 'checkout') checked_out += 1;
		else cancelled += 1;
	}
	const unresolved = await writeHouseholds(
		couchReq,
		db,
		saved,
		memberIds,
		ctx,
		options.auditContext ?? {},
		failed
	);
	const next: ShelterCloseStepState = {
		...state,
		cursor: {
			after: cursor ?? undefined,
			reported: [...(state.cursor.reported ?? []), ...unresolved]
		},
		counters: {
			...state.counters,
			checked_out: state.counters.checked_out + checked_out,
			cancelled: state.counters.cancelled + cancelled
		}
	};
	return withFailures(next, failed, max);
}

async function householdsStep(
	couchReq: CouchReq,
	code: string,
	state: ShelterCloseStepState,
	options: ShelterCloseStepOptions
): Promise<ShelterCloseStepState> {
	const db = shelterDbName(code);
	const max = options.maxFailures ?? Number.POSITIVE_INFINITY;
	const { memberIds } = await readSnapshot(couchReq, db, options);
	// FR-12a / FR-18: re-derive households whose stored status no longer matches their members.
	const reported = new Set(state.cursor.reported ?? []);
	const after = state.cursor.after;
	const remaining = [...memberIds.keys()]
		.filter((hh) => !reported.has(hh) && (after == null || hh > after))
		.sort();
	const ids = remaining.slice(0, SHELTER_CLOSE_CHUNK_SIZE);
	if (ids.length === 0) return { ...state, phase: 'sweep', cursor: {} };
	const failed: ShelterCloseFailure[] = [];
	const { written } = await deriveHouseholds(
		couchReq,
		db,
		ids,
		memberIds,
		(hh) => memberIds.get(hh)?.[0] ?? hh,
		failed,
		true
	);
	const next: ShelterCloseStepState = {
		...state,
		cursor: { after: ids[ids.length - 1], reported: state.cursor.reported },
		counters: {
			...state.counters,
			households_repaired: state.counters.households_repaired + written
		}
	};
	return withFailures(next, failed, max);
}

async function sweepStep(
	couchReq: CouchReq,
	code: string,
	state: ShelterCloseStepState
): Promise<{ state: ShelterCloseStepState; outcome: ShelterCloseStepOutcome | null }> {
	const remaining = await previewShelterClose(couchReq, code);
	if (remaining.total === 0)
		return { state: { ...state, phase: 'finalize', cursor: {} }, outcome: null };
	if (state.sweep_round >= SHELTER_CLOSE_MAX_SWEEPS) {
		return {
			state: { ...state, phase: 'done' },
			outcome: { status: 'completed_with_errors', end_reason: 'sweep_exhausted', closed: false }
		};
	}
	// A new round re-attempts everyone still affected, so last round's failures are dropped:
	// whoever still fails is reported again, whoever succeeded no longer blocks the close.
	return {
		state: {
			...state,
			phase: 'people',
			cursor: {},
			sweep_round: state.sweep_round + 1,
			counters: { ...state.counters, failed: 0 },
			failures: []
		},
		outcome: null
	};
}

async function finalizeStep(
	couchReq: CouchReq,
	code: string,
	state: ShelterCloseStepState,
	options: ShelterCloseStepOptions
): Promise<{ state: ShelterCloseStepState; outcome: ShelterCloseStepOutcome | null }> {
	const mode = options.mode ?? 'close';
	const remaining = await previewShelterClose(couchReq, code);
	if (remaining.total > 0)
		return { state: { ...state, phase: 'sweep', cursor: {} }, outcome: null };
	const failed = state.counters.failed > 0;
	let closed = false;
	if (mode === 'backfill' || !failed) {
		if (options.finalize) closed = (await options.finalize(state)).closed;
	}
	const done: ShelterCloseStepState = { ...state, phase: 'done', cursor: {} };
	return {
		state: done,
		outcome: failed
			? { status: 'completed_with_errors', end_reason: 'failed', closed }
			: { status: 'completed', end_reason: 'ok', closed }
	};
}

/**
 * CR-243 FR-26: run ONE chunk of work for the current phase and return the next state.
 * Phases `people → households → sweep → finalize → done`. Domain logic (check-out, cancel,
 * household derive, retries, rollback) is the same code the one-shot {@link closeShelterPeople}
 * used. Never writes the registry itself — `finalize` is injected (FR-20/FR-21).
 */
export async function stepShelterClose(
	couchReq: CouchReq,
	code: string,
	state: ShelterCloseStepState,
	options: ShelterCloseStepOptions
): Promise<ShelterCloseStepResult> {
	switch (state.phase) {
		case 'people':
			return { state: await peopleStep(couchReq, code, state, options), outcome: null };
		case 'households':
			return { state: await householdsStep(couchReq, code, state, options), outcome: null };
		case 'sweep':
			return sweepStep(couchReq, code, state);
		case 'finalize':
			return finalizeStep(couchReq, code, state, options);
		default:
			return { state, outcome: null };
	}
}

/**
 * FR-9..FR-12: close out every affected stay in `shelter_<code>` in one go — the step function
 * run through `people` and `households`. Idempotent — a re-run only touches people still in an
 * affected status, so it never adds a second movement for the same person.
 */
export async function closeShelterPeople(
	couchReq: CouchReq,
	code: string,
	options: ShelterCloseOptions
): Promise<ShelterCloseRun> {
	const db = shelterDbName(code);
	const now = options.now ?? (() => new Date().toISOString());
	const stepOptions: ShelterCloseStepOptions = {
		createdBy: options.createdBy,
		auditContext: options.auditContext,
		now,
		at: now(),
		evacuees: await listEvacuees(couchReq, db)
	};
	let state = initialShelterCloseStepState();
	while (state.phase === 'people' || state.phase === 'households') {
		state = (await stepShelterClose(couchReq, code, state, stepOptions)).state;
	}
	const remaining = await previewShelterClose(couchReq, code);
	return {
		checked_out: state.counters.checked_out,
		cancelled: state.counters.cancelled,
		households_repaired: state.counters.households_repaired,
		failed: state.failures,
		remaining
	};
}
