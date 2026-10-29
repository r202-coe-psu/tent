import type { AuthorContext } from '$lib/db/model';
import { now } from '$lib/db/model';
import { parseQty, qtyGt } from '$lib/utils/qty';
import { ConflictError } from '$lib/utils/errors';
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
	BulkReturnEntryMove,
	BulkReturnPoolReceivedItem,
	BulkReturnPoolV3,
	BulkReturnReceivedRowInput
} from '../../domain/food-supplies';
import type { BulkReturnPoolV3Repository } from '../../data/food-supplies';
import {
	buildBulkReturnReceivedItems,
	BulkReturnReceiveInputError,
	canAppendToPool,
	cancelBulkReturnPoolV3,
	createBulkReturnPoolV3,
	isPoolEmpty,
	isPoolNameTakenAmongOpen,
	pinnedItemsSummary,
	poolSnapshotEntryIds,
	receiveBulkReturnPoolV3,
	resolveBulkReturnEntries,
	submitBulkReturnPoolV3,
	summarizePoolItems
} from '../../domain/food-supplies';
import { assertCanManageBulkReturnPool } from './auth';
import { assertCentralWriteAuthority } from './central-write-authority';
import { resolveCanonicalItemUnits } from './canonical-unit';
import {
	assertNoSkippedDocs,
	BulkReturnPoolEmptyError,
	BulkReturnPoolLockTimeoutError,
	BulkReturnPoolNameTakenError,
	BulkReturnPoolNotEmptyError,
	BulkReturnPoolStateError,
	ConcurrencyCollisionError,
	StockIntegrityError,
	WorkflowValidationError
} from './errors';
import { assertLedgerReplayBase } from './ledger-replay';
import {
	assertOperationUlid,
	isOurLock,
	loadSnapshotPinsForWrite,
	POOL_FENCE_BACKOFF_MS,
	POOL_FENCE_SETTLE_TIMEOUT_MS,
	requirePool,
	resolveDependencies,
	type BulkReturnPoolV3WorkflowDependencies,
	type FenceClock
} from './bulk-return-pool-v3-shared';

export interface BulkReturnStoragePoint {
	id: string;
	name: string;
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
			`Bulk return pool ${pool._id} must be OPEN and unlocked (status ${pool.status}${pool.lock ? `, locked for ${pool.lock.op}` : ''})`,
			pool.status === 'OPEN' ? 'locked' : 'closed'
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
			`Only an OPEN pool can be cancelled (status ${pool.status})`,
			'closed'
		);
	}

	const locked = await poolRepo.mutateCAS(poolId, (current) => {
		if (current.status === 'CANCELLED') return current;
		if (current.status !== 'OPEN') {
			throw new BulkReturnPoolStateError(
				`Only an OPEN pool can be cancelled (status ${current.status})`,
				'closed'
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
	const releaseCancelLock = () =>
		poolRepo.mutateCAS(poolId, (current) =>
			current.status === 'OPEN' && isOurLock(current, 'CANCEL', operationUlid)
				? { ...current, lock: null }
				: current
		);
	if (events.skipped.length > 0) {
		// Fail closed: a skipped entry/void could make a non-empty pool look empty. Release our lock.
		await releaseCancelLock();
		assertNoSkippedDocs(events.skipped, `bulk return pool ${poolId}`);
	}
	// An entry pinned to another closed pool's snapshot is not this pool's (our pool is OPEN: no pin).
	let pins: Map<string, string>;
	try {
		pins = await loadSnapshotPinsForWrite(poolRepo, events, poolId);
	} catch (err) {
		await releaseCancelLock();
		throw err;
	}
	if (!isPoolEmpty(events.entries, events.moves, poolId, events.voids, pins)) {
		await releaseCancelLock();
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
 * An OPEN pool pins nothing, so a submit must not read the pins while another pool the events
 * reference is mid-submit: that pool's snapshot may already hold an entry this one is about to
 * count. The wait applies to ANY referenced pool holding a SUBMIT lock, whatever its lock age: the
 * pool with the stale view (it read its events before a move doc existed) is the one that does not
 * reference the other, so the fresh pool must wait for it even when that lock is younger. Once the
 * other submit commits, its snapshot is read as pins. Two submits that reference each other and run
 * at the same time wait on each other until both time out; that ends in
 * `BulkReturnPoolLockTimeoutError` (each releases its own lock, the user submits again), never in a
 * double count. CANCEL locks are not waited for (a cancel writes no snapshot). Uses the same
 * backoff and timeout as the fence.
 */
async function waitForReferencedSubmitLocks(
	poolRepo: BulkReturnPoolV3Repository,
	events: {
		entries: readonly Pick<BulkReturnEntry, 'pool_id'>[];
		moves: readonly Pick<BulkReturnEntryMove, 'from_pool_id' | 'to_pool_id'>[];
		voids: readonly { pool_id: string }[];
	},
	ownPoolId: string,
	clock: FenceClock
): Promise<void> {
	const otherIds = [
		...new Set([
			...events.entries.map((e) => e.pool_id),
			...events.moves.flatMap((m) => [m.from_pool_id, m.to_pool_id]),
			...events.voids.map((v) => v.pool_id)
		])
	].filter((id) => id !== ownPoolId);
	if (otherIds.length === 0) return;

	const deadline = clock.now() + POOL_FENCE_SETTLE_TIMEOUT_MS;
	for (let attempt = 0; ; attempt++) {
		const pools = await Promise.all(otherIds.map((id) => poolRepo.get(id)));
		const blocking = pools.find(
			(p) => p !== null && p.lock?.op === 'SUBMIT' && p.status === 'OPEN'
		);
		if (!blocking) return;
		if (clock.now() >= deadline) {
			throw new BulkReturnPoolLockTimeoutError(
				`Bulk return pool ${blocking._id} is still locked for SUBMIT after ${POOL_FENCE_SETTLE_TIMEOUT_MS}ms; retry with the same operationUlid`
			);
		}
		const delay = POOL_FENCE_BACKOFF_MS[Math.min(attempt, POOL_FENCE_BACKOFF_MS.length - 1)];
		await clock.sleep(Math.min(delay, Math.max(0, deadline - clock.now())));
	}
}

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
	const {
		poolRepo,
		eventRepo,
		endpointStore: epStore,
		fenceClock
	} = resolveDependencies(deps, ctx);
	assertCentralWriteAuthority(epStore);
	assertCanManageBulkReturnPool(ctx);
	assertOperationUlid(operationUlid);

	const pool = await requirePool(poolRepo, poolId);
	if (pool.status === 'SUBMITTED') return pool;
	if (pool.status !== 'OPEN') {
		throw new BulkReturnPoolStateError(
			`Only an OPEN pool can be submitted (status ${pool.status})`,
			'closed'
		);
	}

	const locked = await poolRepo.mutateCAS(poolId, (current) => {
		if (current.status === 'SUBMITTED') return current;
		if (current.status !== 'OPEN') {
			throw new BulkReturnPoolStateError(
				`Only an OPEN pool can be submitted (status ${current.status})`,
				'closed'
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
		// Fail closed: a skipped doc would drop an entry from (or add a voided one to) the snapshot.
		assertNoSkippedDocs(events.skipped, `bulk return pool ${poolId}`);
		await waitForReferencedSubmitLocks(poolRepo, events, poolId, fenceClock);
		// Entries pinned to another closed pool's snapshot are never re-counted here.
		const pins = await loadSnapshotPinsForWrite(poolRepo, events, poolId);
		snapshot = {
			items_summary: summarizePoolItems(events.entries, events.moves, poolId, events.voids, pins),
			entry_ids: poolSnapshotEntryIds(
				resolveBulkReturnEntries(events.entries, events.moves, events.voids, pins),
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
 *
 * The stored `expected_qty` per item is the snapshot `items_summary` qty. The receive cap counts
 * pinned entries only: an entry in `entry_ids` that is pinned to ANOTHER pool (earliest
 * `submitted_at` wins) is excluded, so a double-counted entry can never be received twice. When the
 * received qty equals the pinned qty but is below the snapshot qty, the row is recorded as
 * `miscount` with a deterministic note unless the caller sent a reason. The same receivable summary
 * is used for a RECEIVED pool so an identical retry still matches the stored record.
 */
export async function receiveBulkReturnPool(
	poolId: string,
	input: ReceiveBulkReturnPoolInput,
	operationUlid: string,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<ReceiveBulkReturnPoolResult> {
	const {
		poolRepo,
		eventRepo,
		catalogRepo,
		endpointStore: epStore
	} = resolveDependencies(deps, ctx);
	assertCentralWriteAuthority(epStore);
	assertCanManageBulkReturnPool(ctx);
	assertOperationUlid(operationUlid);

	const pool = await requirePool(poolRepo, poolId);
	if (pool.status !== 'SUBMITTED' && pool.status !== 'RECEIVED') {
		throw new BulkReturnPoolStateError(
			`Only a SUBMITTED pool can be received (status ${pool.status})`,
			pool.status === 'CANCELLED' ? 'closed' : 'not_submitted'
		);
	}

	// --- pure validation, before any write ---
	// Own pool is included in the pins so submitted_at is compared against the other pools.
	const events = await eventRepo.listForPool(poolId);
	assertNoSkippedDocs(events.skipped, `bulk return pool ${poolId}`);
	const pins = await loadSnapshotPinsForWrite(poolRepo, events);
	const receivable = pinnedItemsSummary(pool, events.entries, pins);
	let received: BulkReturnPoolReceivedItem[];
	try {
		received = buildBulkReturnReceivedItems(pool.items_summary ?? [], input.items, receivable);
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
					`Only a SUBMITTED pool can be received (status ${current.status})`,
					current.status === 'CANCELLED' ? 'closed' : 'not_submitted'
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
			`Bulk return pool ${poolId} was already received with a different record`,
			'conflict'
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
