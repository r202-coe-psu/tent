import type { AuthorContext } from '$lib/db/model';
import { now } from '$lib/db/model';
import { isUlid } from '$lib/db/ulid';
import { addQty, parseQty, subQty } from '$lib/utils/qty';
import { ConflictError } from '$lib/utils/errors';
import { endpointStore } from '$lib/stores/endpoint.svelte';
import { catalogRepository } from '$lib/features/catalog';
import type {
	BulkReturnEntry,
	BulkReturnEntryLoanRef,
	BulkReturnEntryMove,
	BulkReturnEntryReturnerType,
	BulkReturnEntryVoid,
	BulkReturnPoolOverviewRow,
	BulkReturnPoolV3,
	DistributionLog
} from '../../domain/food-supplies';
import {
	allocateBulkReturnToLoans,
	applyBulkEntryToLog,
	assertEntryCanBeMoved,
	buildBulkReturnPoolOverview,
	canAppendToPool,
	canVoidEntry,
	cancelBulkReturnPoolV3,
	createBulkReturnEntry,
	createBulkReturnEntryMove,
	createBulkReturnEntryVoid,
	createBulkReturnPoolV3,
	deriveEntryMoveId,
	deriveEntryVoidId,
	isBulkReturnEligibleItem,
	isLateEntry,
	isPoolEmpty,
	isPoolNameTakenAmongOpen,
	resolveBulkReturnEntries,
	revertBulkEntryFromLog,
	selectOutstandingLoans
} from '../../domain/food-supplies';
import {
	BulkReturnEventRemoteRepository,
	type BulkReturnEventRepository,
	BulkReturnPoolV3RemoteRepository,
	type BulkReturnPoolV3Repository,
	DistributionLogRemoteRepository,
	type DistributionLogRepository
} from '../../data/food-supplies';
import { assertCanManageBulkReturnPool, assertCanWriteBulkReturnEntry } from './auth';
import { assertCentralWriteAuthority } from './central-write-authority';
import type { CanonicalUnitCatalogRepository } from './canonical-unit';
import {
	BulkReturnPoolNameTakenError,
	BulkReturnPoolNotEmptyError,
	BulkReturnPoolStateError,
	ConcurrencyCollisionError,
	WorkflowValidationError
} from './errors';
import { assertPositiveIntegerQty } from './validation';

export interface BulkReturnPoolV3WorkflowDependencies {
	poolRepo?: BulkReturnPoolV3Repository;
	eventRepo?: BulkReturnEventRepository;
	logRepo?: DistributionLogRepository;
	catalogRepo?: Pick<CanonicalUnitCatalogRepository, 'listItemMasters'>;
	endpointStore?: { active: string; isWritable: boolean };
}

interface ResolvedDependencies {
	poolRepo: BulkReturnPoolV3Repository;
	eventRepo: BulkReturnEventRepository;
	logRepo: DistributionLogRepository;
	catalogRepo: Pick<CanonicalUnitCatalogRepository, 'listItemMasters'>;
	endpointStore: { active: string; isWritable: boolean };
}

function resolveDependencies(
	deps: BulkReturnPoolV3WorkflowDependencies | undefined,
	ctx: AuthorContext
): ResolvedDependencies {
	return {
		poolRepo: deps?.poolRepo ?? new BulkReturnPoolV3RemoteRepository(ctx.shelterCode),
		eventRepo: deps?.eventRepo ?? new BulkReturnEventRemoteRepository(ctx.shelterCode),
		logRepo: deps?.logRepo ?? new DistributionLogRemoteRepository(ctx.shelterCode),
		catalogRepo: deps?.catalogRepo ?? catalogRepository(),
		endpointStore:
			deps?.endpointStore ??
			(typeof endpointStore !== 'undefined'
				? { active: endpointStore.active, isWritable: endpointStore.status === 'connected' }
				: { active: 'central', isWritable: true })
	};
}

export interface BulkReturnStoragePoint {
	id: string;
	name: string;
}

function assertOperationUlid(operationUlid: string): void {
	if (!isUlid(operationUlid)) {
		throw new WorkflowValidationError(`operationUlid must be a ULID: ${operationUlid}`);
	}
}

function poolIdFromOperation(operationUlid: string): string {
	return `bulk_return_pool:${operationUlid}`;
}

function locationFields(
	storagePoint: BulkReturnStoragePoint | null | undefined
): Pick<BulkReturnPoolV3, 'location_storage_point_id' | 'location_storage_zone'> {
	return storagePoint
		? { location_storage_point_id: storagePoint.id, location_storage_zone: storagePoint.name }
		: {};
}

async function requirePool(poolRepo: BulkReturnPoolV3Repository, poolId: string) {
	const pool = await poolRepo.get(poolId);
	if (!pool) throw new BulkReturnPoolStateError(`Bulk return pool ${poolId} was not found`);
	return pool;
}

function isOurLock(pool: Pick<BulkReturnPoolV3, 'lock'>, operationUlid: string): boolean {
	return pool.lock?.op === 'CANCEL' && pool.lock.op_id === operationUlid;
}

// ---------------------------------------------------------------------------------------------
// 1. open
// ---------------------------------------------------------------------------------------------

export interface OpenBulkReturnPoolInput {
	name: string;
	storagePoint?: BulkReturnStoragePoint | null;
	notes?: string;
}

/**
 * Opens an empty (no quantity) pool. `operationUlid` makes the pool id deterministic, so a retry
 * returns the same pool. The duplicate-name check among OPEN pools is advisory only.
 */
export async function openBulkReturnPool(
	input: OpenBulkReturnPoolInput,
	operationUlid: string,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<BulkReturnPoolV3> {
	const { poolRepo, endpointStore: epStore } = resolveDependencies(deps, ctx);
	assertCentralWriteAuthority(epStore);
	assertCanManageBulkReturnPool(ctx);
	assertOperationUlid(operationUlid);

	const id = poolIdFromOperation(operationUlid);
	const candidate = createBulkReturnPoolV3(
		{
			name: input.name,
			...locationFields(input.storagePoint),
			...(input.notes ? { notes: input.notes } : {})
		},
		ctx,
		id
	);

	const existing = await poolRepo.get(id);
	if (existing) return assertSamePoolReplay(existing, candidate);

	if (isPoolNameTakenAmongOpen(candidate.name, await poolRepo.list())) {
		throw new BulkReturnPoolNameTakenError(
			`An open bulk return pool named "${candidate.name}" already exists`
		);
	}

	try {
		return await poolRepo.create(candidate);
	} catch (err) {
		if (!(err instanceof ConflictError)) throw err;
		const winner = await poolRepo.get(id);
		if (!winner) throw err;
		return assertSamePoolReplay(winner, candidate);
	}
}

function assertSamePoolReplay(actual: BulkReturnPoolV3, expected: BulkReturnPoolV3) {
	if (actual.name !== expected.name) {
		throw new ConcurrencyCollisionError(
			`Bulk return pool ${expected._id} already exists with a different name`
		);
	}
	return actual;
}

// ---------------------------------------------------------------------------------------------
// 2. update header
// ---------------------------------------------------------------------------------------------

export interface UpdateBulkReturnPoolHeaderPatch {
	name?: string;
	/** `null` clears the location (point id and name snapshot). */
	storagePoint?: BulkReturnStoragePoint | null;
	/** `null` or empty clears the notes. */
	notes?: string | null;
}

function assertPoolEditable(pool: BulkReturnPoolV3): void {
	if (!canAppendToPool(pool)) {
		throw new BulkReturnPoolStateError(
			`Bulk return pool ${pool._id} must be OPEN and unlocked (status ${pool.status}${pool.lock ? `, locked for ${pool.lock.op}` : ''})`
		);
	}
}

export async function updateBulkReturnPoolHeader(
	poolId: string,
	patch: UpdateBulkReturnPoolHeaderPatch,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<BulkReturnPoolV3> {
	const { poolRepo, endpointStore: epStore } = resolveDependencies(deps, ctx);
	assertCentralWriteAuthority(epStore);
	assertCanManageBulkReturnPool(ctx);

	if (patch.name !== undefined && patch.name.trim() === '') {
		throw new WorkflowValidationError('Pool name must not be empty');
	}
	const pool = await requirePool(poolRepo, poolId);
	assertPoolEditable(pool);
	if (
		patch.name !== undefined &&
		isPoolNameTakenAmongOpen(patch.name, await poolRepo.list(), poolId)
	) {
		throw new BulkReturnPoolNameTakenError(
			`An open bulk return pool named "${patch.name.trim()}" already exists`
		);
	}

	return poolRepo.mutateCAS(poolId, (current) => {
		assertPoolEditable(current);
		const next: BulkReturnPoolV3 = { ...current };
		if (patch.name !== undefined) next.name = patch.name;
		if (patch.storagePoint !== undefined) {
			delete next.location_storage_point_id;
			delete next.location_storage_zone;
			Object.assign(next, locationFields(patch.storagePoint));
		}
		if (patch.notes !== undefined) {
			if (patch.notes && patch.notes.trim()) next.notes = patch.notes;
			else delete next.notes;
		}
		return JSON.stringify(next) === JSON.stringify(current) ? current : next;
	});
}

// ---------------------------------------------------------------------------------------------
// 3. add entries
// ---------------------------------------------------------------------------------------------

export type BulkReturnReturnerInput =
	{ type: 'evacuee' | 'volunteer'; id: string } | { type: 'unspecified' };

export interface AddBulkReturnEntriesInput {
	pool_id: string;
	returner: BulkReturnReturnerInput;
	items: { item_id: string; qty: string; operationUlid: string }[];
	notes?: string;
}

export interface AddBulkReturnEntryResult {
	entry: BulkReturnEntry;
	/** The pool stopped accepting entries before the loans were touched: move the entry out. */
	late: boolean;
	replayed: boolean;
	/** Ids of the distribution logs this entry is applied to (empty when late or voided). */
	loansApplied: string[];
	/** Part of the qty not allocated to any loan (goes into the pool without a loan ref). */
	unallocated_qty: string;
}

export interface AddBulkReturnEntriesResult {
	/** One result per item that was written; see the fence note on `addBulkReturnEntries`. */
	results: AddBulkReturnEntryResult[];
	/** False for an unspecified returner. */
	returner_had_outstanding_loans: boolean;
	/** Specified returner with no outstanding loan for any added item: UI warns, the write is allowed. */
	no_outstanding_loan: boolean;
}

type LoanLike = DistributionLog;

function returnerIdOf(returner: BulkReturnReturnerInput): string | null {
	return returner.type === 'unspecified' ? null : returner.id;
}

function assertReturnerShape(returner: BulkReturnReturnerInput): void {
	if (returner.type === 'unspecified') return;
	if (returner.type !== 'evacuee' && returner.type !== 'volunteer') {
		throw new WorkflowValidationError('returner type must be evacuee, volunteer or unspecified');
	}
	if (!returner.id.startsWith(`${returner.type}:`)) {
		throw new WorkflowValidationError(`returner id must start with ${returner.type}:`);
	}
}

/** Outstanding returnable loans of `returnerId` across all items, oldest first. */
function outstandingLoansOf(loans: readonly LoanLike[], returnerId: string): LoanLike[] {
	const itemIds = [...new Set(loans.map((loan) => loan.item_id))];
	return itemIds
		.flatMap((itemId) => selectOutstandingLoans(loans, { returnerId, itemId }))
		.sort((a, b) =>
			a.distributed_at !== b.distributed_at
				? a.distributed_at < b.distributed_at
					? -1
					: 1
				: a._id < b._id
					? -1
					: a._id > b._id
						? 1
						: 0
		);
}

function sumRefs(refs: readonly BulkReturnEntryLoanRef[]): string {
	return refs.reduce((acc, ref) => addQty(acc, ref.qty), '0');
}

function assertSameEntry(
	actual: BulkReturnEntry,
	expected: {
		pool_id: string;
		item_id: string;
		qty: string;
		returner_type: BulkReturnEntryReturnerType;
		returner_id: string | null;
	}
): void {
	if (
		actual.pool_id !== expected.pool_id ||
		actual.item_id !== expected.item_id ||
		!parseQty(actual.qty).eq(expected.qty) ||
		actual.returner_type !== expected.returner_type ||
		actual.returner_id !== expected.returner_id
	) {
		throw new ConcurrencyCollisionError(
			`bulk_return_entry ${actual._id} already exists with different content`
		);
	}
}

/** Marks `refs` as claimed on the local loan copies so a later item does not allocate them again. */
function claimOnLocalLoans(
	loans: LoanLike[],
	entry: BulkReturnEntry,
	refs: readonly BulkReturnEntryLoanRef[]
): void {
	for (const ref of refs) {
		const idx = loans.findIndex((loan) => loan._id === ref.distribution_log_id);
		if (idx < 0) continue;
		const loan = loans[idx];
		if ((loan.applied_bulk_entry_ids ?? []).includes(entry._id)) continue; // already counted
		loans[idx] = { ...loan, qty_returned: addQty(loan.qty_returned ?? '0', ref.qty) };
	}
}

/**
 * Records one or more drop-offs (several item kinds, any number of calls) into an OPEN pool and
 * closes / reduces the returner's loans.
 *
 * Order: validate everything (items eligible, pool appendable) before writing; then per item write
 * the entry (put-if-absent, replay-safe), FENCE (re-read the pool), and only then apply the loans.
 * When the fence trips (pool locked / not OPEN after the entry was written) the entry is reported
 * `late` with no loan touched, and processing STOPS: later items are not written, so `results`
 * holds only the items written so far. Retrying with the same operationUlids is idempotent.
 */
export async function addBulkReturnEntries(
	input: AddBulkReturnEntriesInput,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<AddBulkReturnEntriesResult> {
	const {
		poolRepo,
		eventRepo,
		logRepo,
		catalogRepo,
		endpointStore: epStore
	} = resolveDependencies(deps, ctx);
	assertCentralWriteAuthority(epStore);
	assertCanWriteBulkReturnEntry(ctx);

	// --- validate input (no I/O) ---
	if (input.items.length === 0) {
		throw new WorkflowValidationError('At least one item is required');
	}
	assertReturnerShape(input.returner);
	const seenOps = new Set<string>();
	for (const item of input.items) {
		if (!item.item_id) throw new WorkflowValidationError('item_id is required');
		assertPositiveIntegerQty(item.qty, 'qty', `for ${item.item_id}`);
		assertOperationUlid(item.operationUlid);
		if (seenOps.has(item.operationUlid)) {
			throw new WorkflowValidationError(`Duplicate operationUlid ${item.operationUlid}`);
		}
		seenOps.add(item.operationUlid);
	}

	// --- validate against catalog (before any write) ---
	const masters = await catalogRepo.listItemMasters(ctx.shelterCode);
	const mastersById = new Map(masters.map((m) => [m._id, m]));
	for (const item of input.items) {
		const master = mastersById.get(item.item_id);
		if (!master) {
			throw new WorkflowValidationError(`Item master ${item.item_id} was not found`);
		}
		if (!isBulkReturnEligibleItem(master as { returnable?: boolean })) {
			throw new WorkflowValidationError(
				`Item ${item.item_id} is not returnable and cannot be added to a bulk return pool`
			);
		}
	}

	// --- validate pool (before any write); a full replay of already-written entries is allowed ---
	const entryIds = input.items.map((item) => `bulk_return_entry:${item.operationUlid}`);
	const existingEntries = await Promise.all(entryIds.map((id) => eventRepo.getEntry(id)));
	const pool = await requirePool(poolRepo, input.pool_id);
	if (!canAppendToPool(pool) && existingEntries.some((entry) => entry === null)) {
		throw new BulkReturnPoolStateError(
			`Bulk return pool ${pool._id} is not accepting entries (status ${pool.status}${pool.lock ? `, locked for ${pool.lock.op}` : ''})`
		);
	}

	// --- load the returner's loans once ---
	const returnerId = returnerIdOf(input.returner);
	const loans: LoanLike[] = returnerId
		? await logRepo.list({ recipient_id: returnerId, is_returnable: true })
		: [];
	const returner_had_outstanding_loans =
		returnerId !== null && outstandingLoansOf(loans, returnerId).length > 0;
	const no_outstanding_loan =
		returnerId !== null &&
		!input.items.some(
			(item) => selectOutstandingLoans(loans, { returnerId, itemId: item.item_id }).length > 0
		);

	const returner_type: BulkReturnEntryReturnerType = input.returner.type;
	const results: AddBulkReturnEntryResult[] = [];

	for (let i = 0; i < input.items.length; i++) {
		const item = input.items[i];
		const expected = {
			pool_id: input.pool_id,
			item_id: item.item_id,
			qty: item.qty,
			returner_type,
			returner_id: returnerId
		};

		let entry = existingEntries[i];
		let replayed = entry !== null;
		if (entry) {
			assertSameEntry(entry, expected);
			claimOnLocalLoans(loans, entry, entry.loan_refs);
		} else {
			// DEFAULT policy, not confirmed by the user: oldest-first allocation, implemented only in the
			// domain helper allocateBulkReturnToLoans (single place to change).
			const refs = returnerId
				? allocateBulkReturnToLoans(
						selectOutstandingLoans(loans, { returnerId, itemId: item.item_id }),
						item.qty
					)
				: [];
			const doc = createBulkReturnEntry(
				{
					pool_id: input.pool_id,
					item_id: item.item_id,
					qty: item.qty,
					returner_type,
					returner_id: returnerId,
					loan_refs: refs,
					...(input.notes ? { notes: input.notes } : {})
				},
				ctx,
				item.operationUlid
			);
			try {
				entry = await eventRepo.createEntry(doc);
			} catch (err) {
				if (!(err instanceof ConflictError)) throw err;
				const winner = await eventRepo.getEntry(doc._id);
				if (!winner) throw err;
				assertSameEntry(winner, expected);
				entry = winner;
				replayed = true;
			}
			claimOnLocalLoans(loans, entry, entry.loan_refs);
		}

		const unallocated_qty = subQty(entry.qty, sumRefs(entry.loan_refs));

		// FENCE: the pool may have been locked / submitted / cancelled after the entry landed.
		const fresh = await poolRepo.get(input.pool_id);
		if (!fresh || !canAppendToPool(fresh)) {
			results.push({ entry, late: true, replayed, loansApplied: [], unallocated_qty });
			break;
		}

		// A replayed entry may have been voided meanwhile: never re-apply its loans.
		const voided = replayed && (await eventRepo.getVoid(deriveEntryVoidId(entry._id))) !== null;
		const loansApplied: string[] = [];
		if (!voided) {
			for (const ref of entry.loan_refs) {
				// QUESTION: if the loan drifted since allocation (outstanding < ref.qty, or the loan was
				// cleared as lost/waived), apply throws after the entry is already written; the spec does
				// not say how to reconcile (shrink the ref? void the entry?).
				await applyRefToLoan(logRepo, entry, ref, ctx);
				loansApplied.push(ref.distribution_log_id);
			}
		}
		results.push({ entry, late: false, replayed, loansApplied, unallocated_qty });
	}

	return { results, returner_had_outstanding_loans, no_outstanding_loan };
}

async function applyRefToLoan(
	logRepo: DistributionLogRepository,
	entry: BulkReturnEntry,
	ref: BulkReturnEntryLoanRef,
	ctx: AuthorContext
): Promise<void> {
	await logRepo.mutateLogCAS(ref.distribution_log_id, (current) =>
		applyBulkEntryToLog(current, { entry_id: entry._id, qty: ref.qty }, ctx.createdBy, now())
	);
}

async function revertRefOnLoan(
	logRepo: DistributionLogRepository,
	entry: BulkReturnEntry,
	ref: BulkReturnEntryLoanRef,
	ctx: AuthorContext
): Promise<void> {
	await logRepo.mutateLogCAS(ref.distribution_log_id, (current) =>
		revertBulkEntryFromLog(current, { entry_id: entry._id, qty: ref.qty }, ctx.createdBy, now())
	);
}

// ---------------------------------------------------------------------------------------------
// 4. move
// ---------------------------------------------------------------------------------------------

export interface MoveBulkReturnEntryInput {
	entry_id: string;
	to_pool_id: string;
	notes?: string;
}

export interface MoveBulkReturnEntryResult {
	move: BulkReturnEntryMove;
	/** The target pool stopped accepting entries right after the move: move the entry again. */
	late: boolean;
	replayed: boolean;
}

/** Moves a whole entry to another OPEN pool. Loans are untouched. */
export async function moveBulkReturnEntry(
	input: MoveBulkReturnEntryInput,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<MoveBulkReturnEntryResult> {
	const { poolRepo, eventRepo, endpointStore: epStore } = resolveDependencies(deps, ctx);
	assertCentralWriteAuthority(epStore);
	assertCanWriteBulkReturnEntry(ctx);

	const events = await eventRepo.listAll();
	const entry = events.entries.find((e) => e._id === input.entry_id);
	if (!entry) throw new WorkflowValidationError(`bulk_return_entry ${input.entry_id} not found`);
	try {
		assertEntryCanBeMoved(entry._id, events.voids);
	} catch (err) {
		throw new WorkflowValidationError(err instanceof Error ? err.message : String(err));
	}

	const resolved = resolveBulkReturnEntries(events.entries, events.moves, events.voids).find(
		(r) => r.entry._id === entry._id
	);
	const currentPoolId = resolved?.pool_id ?? entry.pool_id;
	// Replay rule: moves carry no operationUlid, so a retry is recognised when the entry already
	// sits in the target pool AND its latest move (highest seq) went there. An entry created in
	// the target pool (no such move) is "already in target pool" and still rejected.
	if (input.to_pool_id === currentPoolId) {
		const latest = events.moves
			.filter((m) => m.entry_id === entry._id)
			.reduce<BulkReturnEntryMove | undefined>((a, m) => (!a || m.seq > a.seq ? m : a), undefined);
		if (!latest || latest.to_pool_id !== input.to_pool_id) {
			throw new WorkflowValidationError(`Entry ${entry._id} is already in ${input.to_pool_id}`);
		}
		const fence = await poolRepo.get(input.to_pool_id);
		return { move: latest, late: !fence || !canAppendToPool(fence), replayed: true };
	}

	const target = await requirePool(poolRepo, input.to_pool_id);
	if (!canAppendToPool(target)) {
		throw new BulkReturnPoolStateError(
			`Target bulk return pool ${target._id} is not OPEN and unlocked`
		);
	}
	const source = await requirePool(poolRepo, currentPoolId);
	if (!canAppendToPool(source) && !isLateEntry(entry._id, source)) {
		throw new BulkReturnPoolStateError(
			`Entry ${entry._id} cannot leave ${source._id}: the pool is not OPEN and the entry is not late`
		);
	}

	const seq = events.moves.filter((m) => m.entry_id === entry._id).length + 1;
	const doc = createBulkReturnEntryMove(
		{
			entry,
			seq,
			from_pool_id: currentPoolId,
			to_pool_id: input.to_pool_id,
			...(input.notes ? { notes: input.notes } : {})
		},
		ctx
	);

	let move: BulkReturnEntryMove;
	let replayed = false;
	try {
		move = await eventRepo.createMove(doc);
	} catch (err) {
		if (!(err instanceof ConflictError)) throw err;
		const winner = await eventRepo.getMove(deriveEntryMoveId(entry._id, seq));
		if (!winner) throw err;
		if (winner.to_pool_id !== input.to_pool_id || winner.from_pool_id !== currentPoolId) {
			throw new ConcurrencyCollisionError(
				`Entry ${entry._id} was concurrently moved to ${winner.to_pool_id}`
			);
		}
		move = winner;
		replayed = true;
	}

	const fresh = await poolRepo.get(input.to_pool_id);
	return { move, late: !fresh || !canAppendToPool(fresh), replayed };
}

// ---------------------------------------------------------------------------------------------
// 5. void
// ---------------------------------------------------------------------------------------------

export interface VoidBulkReturnEntryInput {
	entry_id: string;
	notes?: string;
}

export interface VoidBulkReturnEntryResult {
	entryVoid: BulkReturnEntryVoid;
	replayed: boolean;
	/** Ids of the distribution logs this entry is reverted on (idempotent; also on replay). */
	loansReverted: string[];
}

/** Voids an entry (only while its pool is OPEN and unlocked) and reopens the loans it closed. */
export async function voidBulkReturnEntry(
	input: VoidBulkReturnEntryInput,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<VoidBulkReturnEntryResult> {
	const { poolRepo, eventRepo, logRepo, endpointStore: epStore } = resolveDependencies(deps, ctx);
	assertCentralWriteAuthority(epStore);
	assertCanWriteBulkReturnEntry(ctx);

	const events = await eventRepo.listAll();
	const entry = events.entries.find((e) => e._id === input.entry_id);
	if (!entry) throw new WorkflowValidationError(`bulk_return_entry ${input.entry_id} not found`);

	const revertLoans = async (): Promise<string[]> => {
		const reverted: string[] = [];
		for (const ref of entry.loan_refs) {
			await revertRefOnLoan(logRepo, entry, ref, ctx);
			reverted.push(ref.distribution_log_id);
		}
		return reverted;
	};

	const existingVoid = await eventRepo.getVoid(deriveEntryVoidId(entry._id));
	if (existingVoid) {
		return { entryVoid: existingVoid, replayed: true, loansReverted: await revertLoans() };
	}

	const resolved = resolveBulkReturnEntries(events.entries, events.moves, events.voids).find(
		(r) => r.entry._id === entry._id
	);
	const poolId = resolved?.pool_id ?? entry.pool_id;
	const pool = await requirePool(poolRepo, poolId);
	if (!canVoidEntry(pool)) {
		throw new BulkReturnPoolStateError(
			`Entry ${entry._id} cannot be voided: pool ${pool._id} is not OPEN and unlocked`
		);
	}

	const doc = createBulkReturnEntryVoid(
		{ entry, pool_id: poolId, ...(input.notes ? { notes: input.notes } : {}) },
		ctx
	);
	let entryVoid: BulkReturnEntryVoid;
	let replayed = false;
	try {
		entryVoid = await eventRepo.createVoid(doc);
	} catch (err) {
		if (!(err instanceof ConflictError)) throw err;
		const winner = await eventRepo.getVoid(doc._id);
		if (!winner) throw err;
		entryVoid = winner;
		replayed = true;
	}

	return { entryVoid, replayed, loansReverted: await revertLoans() };
}

// ---------------------------------------------------------------------------------------------
// 6. cancel
// ---------------------------------------------------------------------------------------------

/**
 * Cancels an EMPTY pool (OPEN -> CANCELLED; the doc is kept). Takes a CANCEL lock first so no new
 * entry is accepted while the emptiness is checked; the lock is released again when the pool is not
 * empty. Idempotent: an already CANCELLED pool is returned as is.
 */
export async function cancelBulkReturnPool(
	poolId: string,
	operationUlid: string,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<BulkReturnPoolV3> {
	const { poolRepo, eventRepo, endpointStore: epStore } = resolveDependencies(deps, ctx);
	assertCentralWriteAuthority(epStore);
	assertCanManageBulkReturnPool(ctx);
	assertOperationUlid(operationUlid);

	const pool = await requirePool(poolRepo, poolId);
	if (pool.status === 'CANCELLED') return pool;
	if (pool.status !== 'OPEN') {
		throw new BulkReturnPoolStateError(
			`Only an OPEN pool can be cancelled (status ${pool.status})`
		);
	}

	const locked = await poolRepo.mutateCAS(poolId, (current) => {
		if (current.status === 'CANCELLED') return current;
		if (current.status !== 'OPEN') {
			throw new BulkReturnPoolStateError(
				`Only an OPEN pool can be cancelled (status ${current.status})`
			);
		}
		if (current.lock) {
			if (isOurLock(current, operationUlid)) return current; // replay
			throw new ConcurrencyCollisionError(
				`Bulk return pool ${poolId} is locked for ${current.lock.op} by another operation`
			);
		}
		return {
			...current,
			lock: { op: 'CANCEL', op_id: operationUlid, locked_at: now(), locked_by: ctx.createdBy }
		};
	});
	if (locked.status === 'CANCELLED') return locked;

	const events = await eventRepo.listAll();
	if (!isPoolEmpty(events.entries, events.moves, poolId, events.voids)) {
		await poolRepo.mutateCAS(poolId, (current) =>
			current.status === 'OPEN' && isOurLock(current, operationUlid)
				? { ...current, lock: null }
				: current
		);
		throw new BulkReturnPoolNotEmptyError(
			`Bulk return pool ${poolId} still has entries; move or void them first`
		);
	}

	return poolRepo.mutateCAS(poolId, (current) => {
		if (current.status === 'CANCELLED') return current;
		if (current.status === 'OPEN' && !isOurLock(current, operationUlid)) {
			throw new ConcurrencyCollisionError(`Bulk return pool ${poolId} lock was taken over`);
		}
		return cancelBulkReturnPoolV3(current, ctx);
	});
}

// ---------------------------------------------------------------------------------------------
// 7. reads
// ---------------------------------------------------------------------------------------------

export interface BulkReturnPoolOverviewQuery {
	includeCancelled?: boolean;
}

/** Pool list read model: per-pool entries, per-item totals, late entries, emptiness. */
export async function getBulkReturnPoolOverview(
	options: BulkReturnPoolOverviewQuery,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<BulkReturnPoolOverviewRow[]> {
	const { poolRepo, eventRepo } = resolveDependencies(deps, ctx);
	const [pools, events] = await Promise.all([poolRepo.list(), eventRepo.listAll()]);
	return buildBulkReturnPoolOverview(pools, events, { includeCancelled: options.includeCancelled });
}

/** Outstanding returnable loans of a returner (all items), oldest first, so the UI can show/warn. */
export async function listReturnerOutstandingLoans(
	returnerId: string,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<DistributionLog[]> {
	if (!returnerId.startsWith('evacuee:') && !returnerId.startsWith('volunteer:')) {
		throw new WorkflowValidationError('returnerId must start with evacuee: or volunteer:');
	}
	const { logRepo } = resolveDependencies(deps, ctx);
	const loans = await logRepo.list({ recipient_id: returnerId, is_returnable: true });
	return outstandingLoansOf(loans, returnerId);
}
