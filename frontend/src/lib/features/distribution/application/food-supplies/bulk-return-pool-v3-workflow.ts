import type { AuthorContext } from '$lib/db/model';
import { now } from '$lib/db/model';
import { isUlid } from '$lib/db/ulid';
import { addQty, parseQty, qtyGt, subQty } from '$lib/utils/qty';
import { ConflictError, NotFoundError } from '$lib/utils/errors';
import { endpointStore } from '$lib/stores/endpoint.svelte';
import { catalogRepository } from '$lib/features/catalog';
import {
	createStockLedger,
	deriveDeterministicLedgerId,
	operationsRepository,
	storageLotFields,
	type OperationsRepository,
	type StockLedger
} from '$lib/features/operations';
import type {
	BulkReturnEntry,
	BulkReturnEntryLoanRef,
	BulkReturnEntryMove,
	BulkReturnEntryReturnerType,
	BulkReturnEntryVoid,
	BulkReturnPoolOverviewRow,
	BulkReturnPoolReceivedItem,
	BulkReturnPoolV3,
	BulkReturnReceivedRowInput,
	BulkReturnLoanDriftReason,
	ClosedBulkReturnLoanRef,
	AppliedBulkReturnLoanRef,
	DistributionLog
} from '../../domain/food-supplies';
import {
	allocateBulkReturnToLoans,
	applyBulkEntryToLog,
	assertEntryCanBeMoved,
	assessBulkReturnRefOnLoan,
	findClosedBulkReturnLoanRefs,
	findAppliedBulkReturnLoanRefs,
	buildBulkReturnPoolOverview,
	buildBulkReturnReceivedItems,
	BulkReturnReceiveInputError,
	canAppendToPool,
	canVoidEntry,
	cancelBulkReturnPoolV3,
	createBulkReturnEntry,
	createBulkReturnEntryMove,
	createBulkReturnEntryVoid,
	createBulkReturnPoolV3,
	deriveEntryMoveId,
	deriveEntryVoidId,
	foldEntryMoves,
	isBulkReturnEligibleItem,
	isLateEntry,
	isPoolEmpty,
	isPoolNameTakenAmongOpen,
	poolSnapshotEntryIds,
	receiveBulkReturnPoolV3,
	resolveBulkReturnEntries,
	revertBulkEntryFromLog,
	selectOutstandingLoans,
	submitBulkReturnPoolV3,
	summarizePoolItems
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
import { resolveCanonicalItemUnits, type CanonicalUnitCatalogRepository } from './canonical-unit';
import {
	BulkReturnPoolEmptyError,
	BulkReturnPoolNameTakenError,
	BulkReturnPoolNotEmptyError,
	BulkReturnPoolStateError,
	ConcurrencyCollisionError,
	StockIntegrityError,
	WorkflowValidationError
} from './errors';
import { assertLedgerReplayBase } from './ledger-replay';
import { assertPositiveIntegerQty } from './validation';

export interface BulkReturnPoolV3WorkflowDependencies {
	poolRepo?: BulkReturnPoolV3Repository;
	eventRepo?: BulkReturnEventRepository;
	logRepo?: DistributionLogRepository;
	catalogRepo?: CanonicalUnitCatalogRepository;
	/** Receive only: ledger writer (default: the shelter's operations repository). */
	operationsRepo?: OperationsRepository;
	endpointStore?: { active: string; isWritable: boolean };
}

interface ResolvedDependencies {
	poolRepo: BulkReturnPoolV3Repository;
	eventRepo: BulkReturnEventRepository;
	logRepo: DistributionLogRepository;
	catalogRepo: CanonicalUnitCatalogRepository;
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

function isOurLock(
	pool: Pick<BulkReturnPoolV3, 'lock'>,
	op: 'SUBMIT' | 'CANCEL',
	operationUlid: string
): boolean {
	return pool.lock?.op === op && pool.lock.op_id === operationUlid;
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

export interface BulkReturnLoanSkipped {
	distribution_log_id: string;
	qty: string;
	reason: BulkReturnLoanDriftReason;
	/** Outstanding on the loan when skipped (absent for a missing loan). */
	outstanding?: string;
}

export interface AddBulkReturnEntryResult {
	entry: BulkReturnEntry;
	/** The pool stopped accepting entries before the loans were touched: move the entry out. */
	late: boolean;
	replayed: boolean;
	/** Ids of the distribution logs this entry is applied to (empty when late or voided). */
	loansApplied: string[];
	/**
	 * Refs NOT applied because the loan drifted since allocation (closed / outstanding too low /
	 * missing). The entry is kept and still counts in the pool.
	 */
	loansSkipped: BulkReturnLoanSkipped[];
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
 * `late` with no loan touched (its loans are applied later, when it is moved into an OPEN pool),
 * and processing STOPS: later items are not written, so `results`
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
			results.push({
				entry,
				late: true,
				replayed,
				loansApplied: [],
				loansSkipped: [],
				unallocated_qty
			});
			break;
		}

		// A replayed entry may have been voided meanwhile: never re-apply its loans.
		const voided = replayed && (await eventRepo.getVoid(deriveEntryVoidId(entry._id))) !== null;
		const loansApplied: string[] = [];
		const loansSkipped: BulkReturnLoanSkipped[] = [];
		if (!voided) {
			for (const ref of entry.loan_refs) {
				// Loan drift rule: the ref is applied only if the loan, read fresh inside the CAS, can still
				// take the WHOLE ref.qty. A missing / closed loan or outstanding < ref.qty is skipped (no
				// write, no throw): the entry stays and the item still counts in the pool; the UI derives a
				// warning at read time. Never a partial apply: void reverts ref.qty and no per-entry applied
				// qty is persisted, so a partial apply would over-revert on a later void.
				const skipped = await applyRefToLoan(logRepo, entry, ref, ctx);
				if (skipped) loansSkipped.push(skipped);
				else loansApplied.push(ref.distribution_log_id);
			}
		}
		results.push({ entry, late: false, replayed, loansApplied, loansSkipped, unallocated_qty });
	}

	return { results, returner_had_outstanding_loans, no_outstanding_loan };
}

/** Applies one ref; returns why it was skipped, or null when applied (or already applied). */
async function applyRefToLoan(
	logRepo: DistributionLogRepository,
	entry: BulkReturnEntry,
	ref: BulkReturnEntryLoanRef,
	ctx: AuthorContext
): Promise<BulkReturnLoanSkipped | null> {
	return (await applyRefToLoanDetailed(logRepo, entry, ref, ctx)).skipped;
}

/** Like applyRefToLoan, but also reports whether this call newly wrote the apply. */
async function applyRefToLoanDetailed(
	logRepo: DistributionLogRepository,
	entry: BulkReturnEntry,
	ref: BulkReturnEntryLoanRef,
	ctx: AuthorContext
): Promise<{ skipped: BulkReturnLoanSkipped | null; written: boolean }> {
	let skipped = null as BulkReturnLoanSkipped | null;
	let written = false;
	try {
		await logRepo.mutateLogCAS(ref.distribution_log_id, (current) => {
			skipped = null; // the mutator may run again on a CAS retry
			written = false;
			const assessment = assessBulkReturnRefOnLoan(current, ref, entry._id);
			if (assessment.status === 'already_applied') return current;
			if (assessment.status === 'skip') {
				skipped = {
					distribution_log_id: ref.distribution_log_id,
					qty: ref.qty,
					reason: assessment.reason,
					...(assessment.outstanding !== undefined ? { outstanding: assessment.outstanding } : {})
				};
				return current; // same reference: the repository writes nothing
			}
			written = true;
			return applyBulkEntryToLog(
				current,
				{ entry_id: entry._id, qty: ref.qty },
				ctx.createdBy,
				now()
			);
		});
	} catch (err) {
		if (!(err instanceof NotFoundError)) throw err;
		return {
			skipped: { distribution_log_id: ref.distribution_log_id, qty: ref.qty, reason: 'missing' },
			written: false
		};
	}
	return { skipped, written };
}

/**
 * Applies an entry's loan refs once its pool is known to be appendable (move path). `loansApplied`
 * holds only refs newly written by this call; already-applied refs are silent no-ops.
 */
async function applyEntryLoansAfterMove(
	logRepo: DistributionLogRepository,
	poolRepo: BulkReturnPoolV3Repository,
	entry: BulkReturnEntry,
	toPoolId: string,
	ctx: AuthorContext
): Promise<{ late: boolean; loansApplied: string[]; loansSkipped: BulkReturnLoanSkipped[] }> {
	const fresh = await poolRepo.get(toPoolId);
	if (!fresh || !canAppendToPool(fresh)) return { late: true, loansApplied: [], loansSkipped: [] };
	const loansApplied: string[] = [];
	const loansSkipped: BulkReturnLoanSkipped[] = [];
	for (const ref of entry.loan_refs) {
		const { skipped, written } = await applyRefToLoanDetailed(logRepo, entry, ref, ctx);
		if (skipped) loansSkipped.push(skipped);
		else if (written) loansApplied.push(ref.distribution_log_id);
	}
	return { late: false, loansApplied, loansSkipped };
}

async function revertRefOnLoan(
	logRepo: DistributionLogRepository,
	entry: BulkReturnEntry,
	ref: BulkReturnEntryLoanRef,
	ctx: AuthorContext
): Promise<boolean> {
	let reverted = false;
	try {
		// No-op (same reference, no write) when the entry id is not in applied_bulk_entry_ids, which
		// is the case for a ref that was skipped by loan drift or already reverted.
		await logRepo.mutateLogCAS(ref.distribution_log_id, (current) => {
			// CAS may retry the mutator: decide from the loan this run saw.
			reverted = (current.applied_bulk_entry_ids ?? []).includes(entry._id);
			return revertBulkEntryFromLog(
				current,
				{ entry_id: entry._id, qty: ref.qty },
				ctx.createdBy,
				now()
			);
		});
	} catch (err) {
		// A missing loan can hold no applied entry: nothing to revert (never wedge the void).
		if (!(err instanceof NotFoundError)) throw err;
		return false;
	}
	return reverted;
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
	/** Loans newly applied by this call (distribution_log ids; excludes already-applied refs). */
	loansApplied: string[];
	/** Refs not applied (loan closed / missing / insufficient); empty when late. */
	loansSkipped: BulkReturnLoanSkipped[];
}

/**
 * An entry whose move chain has a gap is omitted from the resolved fold, so its current pool is
 * unknowable: writing a move/void now would target the wrong pool or seq. Reject until it syncs.
 */
function assertEntryNotPendingSync(entry: BulkReturnEntry, moves: readonly BulkReturnEntryMove[]) {
	const fold = foldEntryMoves(
		entry,
		moves.filter((m) => m.entry_id === entry._id)
	);
	if (fold.status === 'pending') {
		throw new WorkflowValidationError(
			`Entry ${entry._id} is pending sync (move seq ${fold.missing_seqs.join(', ')} not replicated yet); try again later`
		);
	}
}

/**
 * Moves a whole entry to another OPEN pool. After the move, the target pool is re-read (fence);
 * only if it is still appendable are the entry's loan refs applied (same per-ref rule as add,
 * idempotent via applied_bulk_entry_ids). This is how a late entry (whose loans add never applied)
 * finally clears its loans. A normal, already-applied entry is a no-op on loans.
 */
export async function moveBulkReturnEntry(
	input: MoveBulkReturnEntryInput,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<MoveBulkReturnEntryResult> {
	const { poolRepo, eventRepo, logRepo, endpointStore: epStore } = resolveDependencies(deps, ctx);
	assertCentralWriteAuthority(epStore);
	assertCanWriteBulkReturnEntry(ctx);

	// Only this entry's own chain matters: read it alone so another pool's bad doc cannot block it.
	const events = await eventRepo.listForEntry(input.entry_id);
	const entry = events.entries.find((e) => e._id === input.entry_id);
	if (!entry) throw new WorkflowValidationError(`bulk_return_entry ${input.entry_id} not found`);
	try {
		assertEntryCanBeMoved(entry._id, events.voids);
	} catch (err) {
		throw new WorkflowValidationError(err instanceof Error ? err.message : String(err));
	}
	assertEntryNotPendingSync(entry, events.moves);

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
		const outcome = await applyEntryLoansAfterMove(logRepo, poolRepo, entry, input.to_pool_id, ctx);
		return { move: latest, replayed: true, ...outcome };
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

	const outcome = await applyEntryLoansAfterMove(logRepo, poolRepo, entry, input.to_pool_id, ctx);
	return { move, replayed, ...outcome };
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
	/**
	 * Ids of loans actually reverted by this call (a ref never applied, or already reverted by an
	 * earlier call/replay, is not listed).
	 */
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

	const events = await eventRepo.listForEntry(input.entry_id);
	const entry = events.entries.find((e) => e._id === input.entry_id);
	if (!entry) throw new WorkflowValidationError(`bulk_return_entry ${input.entry_id} not found`);

	const revertLoans = async (): Promise<string[]> => {
		const reverted: string[] = [];
		for (const ref of entry.loan_refs) {
			if (await revertRefOnLoan(logRepo, entry, ref, ctx)) {
				reverted.push(ref.distribution_log_id);
			}
		}
		return reverted;
	};

	const existingVoid = await eventRepo.getVoid(deriveEntryVoidId(entry._id));
	if (existingVoid) {
		return { entryVoid: existingVoid, replayed: true, loansReverted: await revertLoans() };
	}
	assertEntryNotPendingSync(entry, events.moves);

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
			if (isOurLock(current, 'CANCEL', operationUlid)) return current; // replay
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

	const events = await eventRepo.listForPool(poolId);
	if (!isPoolEmpty(events.entries, events.moves, poolId, events.voids)) {
		await poolRepo.mutateCAS(poolId, (current) =>
			current.status === 'OPEN' && isOurLock(current, 'CANCEL', operationUlid)
				? { ...current, lock: null }
				: current
		);
		throw new BulkReturnPoolNotEmptyError(
			`Bulk return pool ${poolId} still has entries; move or void them first`
		);
	}

	return poolRepo.mutateCAS(poolId, (current) => {
		if (current.status === 'CANCELLED') return current;
		if (current.status === 'OPEN' && !isOurLock(current, 'CANCEL', operationUlid)) {
			throw new ConcurrencyCollisionError(`Bulk return pool ${poolId} lock was taken over`);
		}
		return cancelBulkReturnPoolV3(current, ctx);
	});
}

// ---------------------------------------------------------------------------------------------
// 6b. submit
// ---------------------------------------------------------------------------------------------

/**
 * Submits an OPEN pool to the warehouse (OPEN -> SUBMITTED). Takes a SUBMIT lock first so no new
 * entry is accepted while the snapshot is computed, then writes `items_summary` + `entry_ids` and
 * clears the lock. No stock is written here (stock moves at receive). Entries that land after the
 * lock are late and are not part of the snapshot. A pool with no live entry is refused
 * (BulkReturnPoolEmptyError, lock released): cancel it instead. Idempotent: an already SUBMITTED
 * pool is returned as is.
 */
export async function submitBulkReturnPool(
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
	if (pool.status === 'SUBMITTED') return pool;
	if (pool.status !== 'OPEN') {
		throw new BulkReturnPoolStateError(
			`Only an OPEN pool can be submitted (status ${pool.status})`
		);
	}

	const locked = await poolRepo.mutateCAS(poolId, (current) => {
		if (current.status === 'SUBMITTED') return current;
		if (current.status !== 'OPEN') {
			throw new BulkReturnPoolStateError(
				`Only an OPEN pool can be submitted (status ${current.status})`
			);
		}
		if (current.lock) {
			if (isOurLock(current, 'SUBMIT', operationUlid)) return current; // replay
			throw new ConcurrencyCollisionError(
				`Bulk return pool ${poolId} is locked for ${current.lock.op} by another operation`
			);
		}
		return {
			...current,
			lock: { op: 'SUBMIT', op_id: operationUlid, locked_at: now(), locked_by: ctx.createdBy }
		};
	});
	if (locked.status === 'SUBMITTED') return locked;

	const releaseLock = () =>
		poolRepo.mutateCAS(poolId, (current) =>
			current.status === 'OPEN' && isOurLock(current, 'SUBMIT', operationUlid)
				? { ...current, lock: null }
				: current
		);

	let snapshot: { items_summary: ReturnType<typeof summarizePoolItems>; entry_ids: string[] };
	try {
		const events = await eventRepo.listForPool(poolId);
		snapshot = {
			items_summary: summarizePoolItems(events.entries, events.moves, poolId, events.voids),
			entry_ids: poolSnapshotEntryIds(
				resolveBulkReturnEntries(events.entries, events.moves, events.voids),
				poolId
			)
		};
	} catch (err) {
		await releaseLock();
		throw err;
	}
	if (snapshot.entry_ids.length === 0) {
		await releaseLock();
		throw new BulkReturnPoolEmptyError(
			`Bulk return pool ${poolId} has no entries and cannot be submitted; cancel the pool instead`
		);
	}

	return poolRepo.mutateCAS(poolId, (current) => {
		if (current.status === 'SUBMITTED') return current;
		if (current.status === 'OPEN' && !isOurLock(current, 'SUBMIT', operationUlid)) {
			throw new ConcurrencyCollisionError(`Bulk return pool ${poolId} lock was taken over`);
		}
		return submitBulkReturnPoolV3(current, snapshot, ctx);
	});
}

// ---------------------------------------------------------------------------------------------
// 6c. receive
// ---------------------------------------------------------------------------------------------

export interface ReceiveBulkReturnPoolInput {
	/** One row per pool item (`items_summary`); see `buildBulkReturnReceivedItems`. */
	items: BulkReturnReceivedRowInput[];
	storagePoint?: BulkReturnStoragePoint | null;
}

export interface ReceiveBulkReturnPoolResult {
	pool: BulkReturnPoolV3;
	/** One row per received item with received_qty > 0, in items_summary order. */
	ledgerEntries: StockLedger[];
	/** The pool was already RECEIVED with the same record (ledger rows were verified / repaired). */
	replayed: boolean;
}

function sameReceivedRecord(
	pool: BulkReturnPoolV3,
	received: readonly BulkReturnPoolReceivedItem[],
	storagePointId: string | undefined
): boolean {
	const stored = pool.received_items ?? [];
	if (stored.length !== received.length) return false;
	if ((pool.received_storage_point_id ?? undefined) !== storagePointId) return false;
	const byItem = new Map(stored.map((row) => [row.item_id, row]));
	return received.every((row) => {
		const other = byItem.get(row.item_id);
		return (
			other !== undefined &&
			parseQty(other.received_qty).eq(row.received_qty) &&
			other.discrepancy_reason === row.discrepancy_reason &&
			other.discrepancy_note === row.discrepancy_note
		);
	});
}

/** Put-if-absent of one deterministic receive row; an identical existing row is a replay. */
async function persistBulkReceiveLedger(
	operationsRepo: OperationsRepository,
	entry: StockLedger,
	ctx: AuthorContext
): Promise<StockLedger> {
	let actual: StockLedger;
	try {
		actual = await operationsRepo.addLedgerEntry(entry);
	} catch (err) {
		if (!(err instanceof ConflictError)) throw err;
		const recovered = await operationsRepo.getLedgerEntry(entry._id);
		if (!recovered) {
			throw new StockIntegrityError(
				`ConflictError on ${entry._id} but the existing bulk return ledger row could not be fetched`
			);
		}
		actual = recovered;
	}
	const mismatch = `Bulk return receive ledger replay mismatch for ${entry._id}`;
	assertLedgerReplayBase(
		actual,
		{
			id: entry._id,
			schemaVersion: entry.schema_v,
			shelterCode: ctx.shelterCode,
			reason: 'receive',
			refId: entry.ref_id,
			itemId: entry.item_id,
			qty: entry.qty,
			unit: entry.unit,
			lotRef: entry.lot_ref
		},
		mismatch
	);
	if (
		actual.lot?.note !== 'bulk_return_pool' ||
		actual.lot?.storage_point_id !== entry.lot?.storage_point_id
	) {
		throw new StockIntegrityError(mismatch);
	}
	return actual;
}

/**
 * Warehouse confirms what actually arrived (SUBMITTED -> RECEIVED) and the stock is booked.
 *
 * Order is deliberate: the pool CAS is the single serialization point; the ledger rows are derived
 * only from the COMMITTED pool record, so two concurrent receivers can never leave mixed ledger
 * rows. One `receive` row per item with received_qty > 0, id =
 * `deriveDeterministicLedgerId('bulk_return_receive', poolId, itemId)`, put-if-absent. Repeating the
 * call with the same input (or retrying after a crash between pool and ledger) is idempotent and
 * repairs missing rows; a different input on a RECEIVED pool is a BulkReturnPoolStateError.
 * `operationUlid` is validated but not persisted.
 */
export async function receiveBulkReturnPool(
	poolId: string,
	input: ReceiveBulkReturnPoolInput,
	operationUlid: string,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<ReceiveBulkReturnPoolResult> {
	const { poolRepo, catalogRepo, endpointStore: epStore } = resolveDependencies(deps, ctx);
	assertCentralWriteAuthority(epStore);
	assertCanManageBulkReturnPool(ctx);
	assertOperationUlid(operationUlid);

	const pool = await requirePool(poolRepo, poolId);
	if (pool.status !== 'SUBMITTED' && pool.status !== 'RECEIVED') {
		throw new BulkReturnPoolStateError(
			`Only a SUBMITTED pool can be received (status ${pool.status})`
		);
	}

	// --- pure validation, before any write ---
	let received: BulkReturnPoolReceivedItem[];
	try {
		received = buildBulkReturnReceivedItems(pool.items_summary ?? [], input.items);
	} catch (err) {
		if (err instanceof BulkReturnReceiveInputError) throw new WorkflowValidationError(err.message);
		throw err;
	}
	const point = input.storagePoint
		? { id: input.storagePoint.id.trim(), name: input.storagePoint.name.trim() }
		: null;
	if (point && (!point.id || !point.name)) {
		throw new WorkflowValidationError('storagePoint needs both an id and a name');
	}

	// --- units, before any write (a missing unit must not leave a RECEIVED pool without stock) ---
	const units = await resolveCanonicalItemUnits(
		received.filter((row) => qtyGt(row.received_qty, 0)).map((row) => row.item_id),
		ctx,
		catalogRepo
	);

	// --- a) pool first ---
	let committed = pool;
	let replayed = true;
	if (pool.status === 'SUBMITTED') {
		let wrote = false;
		committed = await poolRepo.mutateCAS(poolId, (current) => {
			wrote = false;
			if (current.status === 'RECEIVED') return current;
			if (current.status !== 'SUBMITTED') {
				throw new BulkReturnPoolStateError(
					`Only a SUBMITTED pool can be received (status ${current.status})`
				);
			}
			wrote = true;
			return receiveBulkReturnPoolV3(
				current,
				{
					received_items: received,
					...(point
						? { received_storage_point_id: point.id, received_storage_zone: point.name }
						: {})
				},
				ctx
			);
		});
		replayed = !wrote;
	}

	// --- b) a RECEIVED pool must carry the record that was asked for ---
	if (replayed && !sameReceivedRecord(committed, received, point?.id)) {
		throw new BulkReturnPoolStateError(
			`Bulk return pool ${poolId} was already received with a different record`
		);
	}

	// --- c) ledger rows from the committed pool ---
	const operationsRepo = deps?.operationsRepo ?? operationsRepository(ctx.shelterCode);
	const storage =
		committed.received_storage_point_id && committed.received_storage_zone
			? { id: committed.received_storage_point_id, name: committed.received_storage_zone }
			: null;
	const ledgerEntries: StockLedger[] = [];
	for (const row of committed.received_items ?? []) {
		if (!qtyGt(row.received_qty, 0)) continue;
		const unit = units.get(row.item_id);
		if (!unit) {
			throw new StockIntegrityError(`No canonical unit resolved for item ${row.item_id}`);
		}
		const ledgerId = await deriveDeterministicLedgerId(
			'bulk_return_receive',
			committed._id,
			row.item_id
		);
		const entry = createStockLedger(
			{
				item_id: row.item_id,
				qty: row.received_qty,
				unit,
				reason: 'receive',
				ref_id: committed._id,
				lot: { note: 'bulk_return_pool', ...storageLotFields(storage) },
				occurred_at: committed.received_at
			},
			ctx,
			ledgerId
		);
		ledgerEntries.push(await persistBulkReceiveLedger(operationsRepo, entry, ctx));
	}

	return { pool: committed, ledgerEntries, replayed };
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

/**
 * Loan-drift warning source: refs of the non-voided entries currently in `poolId` that are not
 * applied to their loan and cannot be applied now (closed / insufficient / missing). Derived from
 * the fresh loans on every read; nothing is persisted.
 */
export async function listBulkReturnPoolClosedLoanRefs(
	poolId: string,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<ClosedBulkReturnLoanRef[]> {
	const { live, loansById } = await loadLivePoolEntriesWithLoans(poolId, ctx, deps);
	return findClosedBulkReturnLoanRefs(live, loansById);
}

/**
 * Refs of the non-voided entries currently in `poolId` that are actually applied on their loan
 * (the entry id is in the loan's `applied_bulk_entry_ids`). Derived from fresh loans on every read.
 */
export async function listBulkReturnPoolAppliedLoanRefs(
	poolId: string,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<AppliedBulkReturnLoanRef[]> {
	const { live, loansById } = await loadLivePoolEntriesWithLoans(poolId, ctx, deps);
	return findAppliedBulkReturnLoanRefs(live, loansById);
}

/** Non-voided entries currently in `poolId` plus the freshly fetched loans their refs point at. */
async function loadLivePoolEntriesWithLoans(
	poolId: string,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<{ live: BulkReturnEntry[]; loansById: Map<string, DistributionLog | null> }> {
	const { eventRepo, logRepo } = resolveDependencies(deps, ctx);
	const events = await eventRepo.listForPool(poolId);
	const live = resolveBulkReturnEntries(events.entries, events.moves, events.voids)
		.filter(({ pool_id, voided }) => !voided && pool_id === poolId)
		.map(({ entry }) => entry);
	const loanIds = [
		...new Set(live.flatMap((entry) => entry.loan_refs.map((ref) => ref.distribution_log_id)))
	];
	if (loanIds.length === 0) return { live, loansById: new Map() };
	const loans = await Promise.all(loanIds.map((id) => logRepo.get(id)));
	return { live, loansById: new Map(loanIds.map((id, i) => [id, loans[i]])) };
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
