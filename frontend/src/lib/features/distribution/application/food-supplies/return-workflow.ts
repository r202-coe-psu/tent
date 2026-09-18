import type { AuthorContext } from '$lib/db/model';
import { now } from '$lib/db/model';
import { isUlid } from '$lib/db/ulid';
import { addQty, parseQty, qtyGt, qtyLte, subQty } from '$lib/utils/qty';
import { ConflictError } from '$lib/utils/errors';
import {
	createStockLedger,
	type OperationsRepository,
	type StockLedger,
	operationsRepository
} from '$lib/features/operations';
import type {
	BulkReturnClaim,
	BulkReturnPool,
	BulkReturnPoolInput,
	DistributionLog,
	ReturnCondition
} from '../../domain/food-supplies';
import {
	createBulkReturnClaim,
	createBulkReturnPool as createBulkReturnPoolDocument,
	deriveClaimIdFromDistributionLog
} from '../../domain/food-supplies';
import {
	BulkReturnClaimRemoteRepository,
	type BulkReturnClaimRepository,
	BulkReturnPoolRemoteRepository,
	type BulkReturnPoolRepository,
	DistributionLogRemoteRepository,
	type DistributionLogRepository
} from '../../data/food-supplies';
import { assertCanPerformFrontlineDistribution, assertCanReceivePhysicalStock } from './auth';
import {
	ConcurrencyCollisionError,
	InsufficientPoolQuotaError,
	StockIntegrityError,
	WorkflowValidationError
} from './errors';
import { assertLedgerReplayBase } from './ledger-replay';
import { assertPositiveQty } from './validation';

export interface ReturnWorkflowDependencies {
	logRepo?: DistributionLogRepository;
	operationsRepo?: OperationsRepository;
	poolRepo?: BulkReturnPoolRepository;
	claimRepo?: BulkReturnClaimRepository;
}

export interface CounterReturnInput {
	qty_returned: string;
	condition_on_return?: ReturnCondition;
	notes?: string;
}

export interface NonPhysicalClearInput {
	clear_reason: 'lost' | 'waived';
	notes: string;
}

export interface CreateBulkPoolInput {
	/** Stable caller-generated ULID reused for every retry of this physical receipt. */
	operationUlid: string;
	item_id: string;
	total_received_qty: string;
	ticket_id?: string;
	shift_id?: string;
	notes?: string;
}

export interface ClearLoanViaBulkPoolInput {
	/** Stable caller-generated ULID reused for retries of this bulk return claim. */
	operationUlid: string;
	logId: string;
	poolId: string;
	notes?: string;
}

function assertBulkPoolLedgerReplay(actual: StockLedger, expected: StockLedger): void {
	assertLedgerReplayBase(
		actual,
		{
			id: expected._id,
			schemaVersion: expected.schema_v,
			shelterCode: expected.shelter_code,
			reason: 'receive',
			refId: expected.ref_id,
			itemId: expected.item_id,
			qty: expected.qty,
			unit: expected.unit,
			lotRef: expected._id
		},
		`Bulk pool ledger replay mismatch for ${expected._id}`
	);

	if (actual.lot?.note !== 'bulk_return_pool') {
		throw new StockIntegrityError(`Bulk pool ledger replay mismatch for ${expected._id}`);
	}
}

function assertBulkPoolReplay(actual: BulkReturnPool, expected: BulkReturnPool): void {
	if (
		actual._id !== expected._id ||
		actual.type !== 'bulk_return_pool' ||
		actual.schema_v !== expected.schema_v ||
		actual.shelter_code !== expected.shelter_code ||
		actual.stock_ledger_id !== expected.stock_ledger_id ||
		actual.item_id !== expected.item_id ||
		!parseQty(actual.total_received_qty).eq(expected.total_received_qty) ||
		actual.ticket_id !== expected.ticket_id ||
		actual.shift_id !== expected.shift_id ||
		actual.notes !== expected.notes
	) {
		throw new StockIntegrityError(`Bulk return pool replay mismatch for ${expected._id}`);
	}
}

function resolveDependencies(
	deps: ReturnWorkflowDependencies | undefined,
	ctx: AuthorContext
): {
	logRepo: DistributionLogRepository;
	operationsRepo: OperationsRepository;
	poolRepo: BulkReturnPoolRepository;
	claimRepo: BulkReturnClaimRepository;
} {
	return {
		logRepo: deps?.logRepo ?? new DistributionLogRemoteRepository(ctx.shelterCode),
		operationsRepo: deps?.operationsRepo ?? operationsRepository(ctx.shelterCode),
		poolRepo: deps?.poolRepo ?? new BulkReturnPoolRemoteRepository(ctx.shelterCode),
		claimRepo: deps?.claimRepo ?? new BulkReturnClaimRemoteRepository(ctx.shelterCode)
	};
}

/**
 * Handles individual counter return of a returnable loan (FR-LON-02).
 * Writes inbound StockLedger entry first, followed by DistributionLog update,
 * ensuring idempotent recovery without duplicate stock receipts across partial failures.
 */
export async function returnLoanAtCounter(
	logId: string,
	input: CounterReturnInput,
	ctx: AuthorContext,
	deps?: ReturnWorkflowDependencies
): Promise<{ log: DistributionLog; ledgerEntryCreated: boolean }> {
	assertCanReceivePhysicalStock(ctx);

	assertPositiveQty(input.qty_returned, 'qty_returned');

	const { logRepo, operationsRepo } = resolveDependencies(deps, ctx);
	const currentLog = await logRepo.get(logId);
	if (!currentLog) {
		throw new WorkflowValidationError(`Distribution log ${logId} not found`);
	}
	if (!currentLog.is_returnable) {
		throw new WorkflowValidationError(`Cannot return non-returnable distribution log ${logId}`);
	}
	if (['lost', 'waived', 'voided'].includes(currentLog.status)) {
		throw new WorkflowValidationError(
			`Distribution log ${logId} is already closed as ${currentLog.status}`
		);
	}
	if (currentLog.status === 'returned' && currentLog.qty_returned !== input.qty_returned) {
		throw new WorkflowValidationError(
			`Distribution log ${logId} is already closed as ${currentLog.status}`
		);
	}
	if (!qtyLte(input.qty_returned, currentLog.qty)) {
		throw new WorkflowValidationError(
			`qty_returned (${input.qty_returned}) cannot exceed issued qty (${currentLog.qty})`
		);
	}
	if (currentLog.qty_returned && qtyGt(currentLog.qty_returned, input.qty_returned)) {
		throw new WorkflowValidationError(
			`qty_returned (${input.qty_returned}) cannot be less than previously returned qty (${currentLog.qty_returned})`
		);
	}

	// 1. Determine previously credited stock entries for this exact log
	const existingLedger = await operationsRepo.listLedger();
	const logReceiveEntries = existingLedger.filter(
		(entry) => entry.ref_id === logId && entry.reason === 'receive'
	);
	const totalPreviouslyReceived = logReceiveEntries.reduce(
		(acc, entry) => addQty(acc, entry.qty),
		'0'
	);

	if (qtyGt(totalPreviouslyReceived, input.qty_returned)) {
		throw new StockIntegrityError(
			`Target return quantity (${input.qty_returned}) is lower than physical stock already credited in ledger (${totalPreviouslyReceived}) for log ${logId}`
		);
	}

	// 2. Compute missing delta to receive into physical inventory
	const deltaToReceive = subQty(input.qty_returned, totalPreviouslyReceived);
	let ledgerEntryCreated = false;

	if (qtyGt(deltaToReceive, 0)) {
		const ledgerEntry = createStockLedger(
			{
				item_id: currentLog.item_id,
				qty: deltaToReceive,
				unit: 'ชิ้น',
				reason: 'receive',
				ref_id: logId,
				lot: { note: 'counter_loan_return' },
				occurred_at: now()
			},
			ctx
		);
		await operationsRepo.addLedgerEntry(ledgerEntry);
		ledgerEntryCreated = true;
	}

	// 3. Complete DistributionLog lifecycle transition if not already in target state
	let updatedLog = currentLog;
	const isAlreadyAtTarget = currentLog.qty_returned === input.qty_returned;
	if (!isAlreadyAtTarget) {
		updatedLog = await logRepo.recordReturn(
			logId,
			{
				qty_returned: input.qty_returned,
				condition_on_return: input.condition_on_return,
				clear_reason: 'routine',
				notes: input.notes
			},
			ctx
		);
	}

	return {
		log: updatedLog,
		ledgerEntryCreated
	};
}

/**
 * Clears a loan non-physically as lost or waived (FR-LON-04).
 * Requires notes. Does NOT create any physical stock receipt.
 */
export async function clearLoanNonPhysical(
	logId: string,
	input: NonPhysicalClearInput,
	ctx: AuthorContext,
	logRepo?: DistributionLogRepository
): Promise<DistributionLog> {
	assertCanPerformFrontlineDistribution(ctx);

	if (!input.notes || !input.notes.trim()) {
		throw new WorkflowValidationError(
			`notes are required when clearing a loan as ${input.clear_reason}`
		);
	}

	const repository = logRepo ?? new DistributionLogRemoteRepository(ctx.shelterCode);
	return repository.recordClear(
		logId,
		{
			clear_reason: input.clear_reason,
			notes: input.notes.trim()
		},
		ctx
	);
}

/**
 * Sets up a Bulk Return Pool for swept/gathered items (FR-LON-02).
 * Writes physical stock receipt ONCE and establishes quota for check-out gate resolutions.
 */
export async function createBulkReturnPool(
	input: CreateBulkPoolInput,
	ctx: AuthorContext,
	deps?: ReturnWorkflowDependencies
): Promise<BulkReturnPool> {
	assertCanReceivePhysicalStock(ctx);

	assertPositiveQty(input.total_received_qty, 'total_received_qty');
	if (!isUlid(input.operationUlid)) {
		throw new WorkflowValidationError('operationUlid must be a valid ULID');
	}

	const { poolRepo, operationsRepo } = resolveDependencies(deps, ctx);
	const poolId = `bulk_return_pool:${input.operationUlid}`;
	const ledgerId = `stock_ledger:${input.operationUlid}`;

	// The operation ULID gives one durable identity to the receipt and pool.
	// A retry must reuse it; create-conflict winners are verified below, never adopted blindly.
	const ledgerEntry = createStockLedger(
		{
			item_id: input.item_id,
			qty: input.total_received_qty,
			unit: 'ชิ้น',
			reason: 'receive',
			ref_id: poolId,
			lot: { note: 'bulk_return_pool' },
			occurred_at: now()
		},
		ctx,
		input.operationUlid
	);
	const poolInput: BulkReturnPoolInput = {
		item_id: input.item_id,
		stock_ledger_id: ledgerId,
		total_received_qty: input.total_received_qty,
		...(input.ticket_id ? { ticket_id: input.ticket_id } : {}),
		...(input.shift_id ? { shift_id: input.shift_id } : {}),
		...(input.notes ? { notes: input.notes } : {})
	};

	const poolDocument = createBulkReturnPoolDocument(poolInput, ctx, input.operationUlid);
	const existingPool = await poolRepo.get(poolId);
	if (existingPool) {
		// COMPLETE or POOL_ONLY state: ledger must already exist
		const existingLedger = await operationsRepo.getLedgerEntry(ledgerId);
		if (!existingLedger) {
			throw new StockIntegrityError(
				`Bulk return pool ${poolId} exists without its physical receipt ${ledgerId}`
			);
		}
		assertBulkPoolLedgerReplay(existingLedger, ledgerEntry);
		assertBulkPoolReplay(existingPool, poolDocument);
		return existingPool;
	}

	// NONE or LEDGER_ONLY state: attempt to write ledger; recover on conflict
	try {
		const persistedLedger = await operationsRepo.addLedgerEntry(ledgerEntry);
		assertBulkPoolLedgerReplay(persistedLedger, ledgerEntry);
	} catch (error) {
		if (!(error instanceof ConflictError)) {
			throw error;
		}
		// LEDGER_ONLY recovery: deterministic ledger already written — fetch and verify
		const recoveredLedger = await operationsRepo.getLedgerEntry(ledgerId);
		if (!recoveredLedger) {
			throw new StockIntegrityError(
				`ConflictError on ${ledgerId} but existing ledger could not be fetched — unrecoverable state`
			);
		}
		assertBulkPoolLedgerReplay(recoveredLedger, ledgerEntry);
	}

	const savedPool = await poolRepo.create(poolDocument, ctx);
	assertBulkPoolReplay(savedPool, poolDocument);
	return savedPool;
}

/**
 * Resolves a returnable loan at check-out gate against a Bulk Return Pool quota (FR-LON-04, CR-129).
 * Coordinates quota claim through deterministic bulk_return_claim, records bulk_dropoff clear on DistributionLog,
 * enforces strict final quantity equality, and creates ZERO stock ledger entries.
 */
export async function clearLoanViaBulkPool(
	input: ClearLoanViaBulkPoolInput,
	ctx: AuthorContext,
	deps?: ReturnWorkflowDependencies
): Promise<{ log: DistributionLog; pool: BulkReturnPool; claim: BulkReturnClaim }> {
	const { logId, poolId, notes, operationUlid } = input;
	if (!isUlid(operationUlid)) {
		throw new WorkflowValidationError('operationUlid must be a valid ULID');
	}

	assertCanPerformFrontlineDistribution(ctx);

	const { logRepo, poolRepo, claimRepo } = resolveDependencies(deps, ctx);

	// Step 0a: Read DistributionLog and target BulkReturnPool
	const currentLog = await logRepo.get(logId);
	if (!currentLog) {
		throw new WorkflowValidationError(`Distribution log ${logId} not found`);
	}
	if (currentLog.shelter_code !== ctx.shelterCode) {
		throw new WorkflowValidationError(
			`Distribution log ${logId} belongs to shelter ${currentLog.shelter_code}, expected ${ctx.shelterCode}`
		);
	}
	if (!currentLog.is_returnable) {
		throw new WorkflowValidationError(`Distribution log ${logId} is not returnable`);
	}

	const claimId = deriveClaimIdFromDistributionLog(logId);

	// Step 19 recovery check: Crash after Log update but before Claim COMPLETE.
	let existingClaim = await claimRepo.get(claimId);

	if (currentLog.status === 'returned') {
		if (existingClaim && existingClaim.operation_id !== operationUlid) {
			throw new ConcurrencyCollisionError(
				`Distribution log ${logId} is already being processed by operation ${existingClaim.operation_id}`
			);
		}
		if (
			existingClaim &&
			currentLog.clear_reason === 'bulk_dropoff' &&
			currentLog.bulk_pool_id === existingClaim.bulk_pool_id &&
			currentLog.qty_returned === currentLog.qty
		) {
			if (existingClaim.status !== 'COMPLETE') {
				existingClaim = await claimRepo.mutateStatusCAS(claimId, 'COMPLETE', ctx);
			}
			const pool = await poolRepo.get(existingClaim.bulk_pool_id);
			if (!pool) {
				throw new WorkflowValidationError(
					`Bulk return pool ${existingClaim.bulk_pool_id} not found during complete recovery`
				);
			}
			return { log: currentLog, pool, claim: existingClaim };
		}
		throw new WorkflowValidationError(
			`Distribution log ${logId} is already returned with conflicting semantics`
		);
	}

	if (currentLog.status !== 'active' && currentLog.status !== 'partially_returned') {
		throw new WorkflowValidationError(
			`Distribution log ${logId} is in invalid status '${currentLog.status}' for bulk return`
		);
	}

	const outstanding = subQty(currentLog.qty, currentLog.qty_returned ?? '0');
	if (qtyLte(outstanding, '0')) {
		throw new WorkflowValidationError(
			`Distribution log ${logId} has no outstanding loan quantity (qty: ${currentLog.qty}, returned: ${currentLog.qty_returned})`
		);
	}

	// Target pool verification
	let targetPool = await poolRepo.get(poolId);
	if (!targetPool) {
		throw new WorkflowValidationError(`Bulk return pool ${poolId} not found`);
	}
	if (targetPool.shelter_code !== ctx.shelterCode) {
		throw new WorkflowValidationError(
			`Bulk return pool ${poolId} belongs to shelter ${targetPool.shelter_code}, expected ${ctx.shelterCode}`
		);
	}
	if (targetPool.item_id !== currentLog.item_id) {
		throw new WorkflowValidationError(
			`Bulk return pool item ${targetPool.item_id} does not match log item ${currentLog.item_id}`
		);
	}

	// Step 0b: Pre-flight Quota Check (Optimization — reject BEFORE creating Claim Doc if pool unusable)
	if (!existingClaim) {
		if (targetPool.status !== 'ACTIVE' || qtyGt(outstanding, targetPool.unclaimed_quota)) {
			throw new InsufficientPoolQuotaError(
				`Bulk return pool ${poolId} has insufficient quota (${targetPool.unclaimed_quota} < ${outstanding}) or status is ${targetPool.status}`
			);
		}

		// Step 1: Create deterministic Claim Intent doc
		try {
			existingClaim = await claimRepo.create(
				createBulkReturnClaim(
					{
						operation_id: operationUlid,
						distribution_log_id: logId,
						bulk_pool_id: poolId,
						item_id: currentLog.item_id,
						claimed_qty: outstanding,
						notes
					},
					ctx
				)
			);
		} catch (err) {
			if (err instanceof ConflictError) {
				existingClaim = await claimRepo.get(claimId);
				if (!existingClaim) {
					throw err;
				}
			} else {
				throw err;
			}
		}
	}

	// Evaluate Claim State Machine & Concurrency Invariants
	if (existingClaim.status === 'ABORTED') {
		// If same operation was already aborted, fail closed
		if (existingClaim.operation_id === operationUlid) {
			throw new InsufficientPoolQuotaError(
				`Claim for distribution log ${logId} was aborted in operation ${operationUlid}`
			);
		}

		// New operation attempting controlled CAS re-initialization
		if (targetPool.status !== 'ACTIVE' || qtyGt(outstanding, targetPool.unclaimed_quota)) {
			throw new InsufficientPoolQuotaError(
				`Target pool ${poolId} has insufficient quota or is unusable for re-initialization`
			);
		}

		try {
			existingClaim = await claimRepo.reinitializeCAS(
				claimId,
				{
					operation_id: operationUlid,
					bulk_pool_id: poolId,
					claimed_qty: outstanding,
					notes
				},
				ctx
			);
		} catch (err) {
			const reloaded = await claimRepo.get(claimId);
			if (reloaded && reloaded.operation_id !== operationUlid && reloaded.status !== 'ABORTED') {
				throw new ConcurrencyCollisionError(
					`Another operation ${reloaded.operation_id} claimed distribution log ${logId} during re-initialization`
				);
			}
			throw err;
		}
	} else if (existingClaim.operation_id !== operationUlid) {
		// Different operation collision on active/effective claim
		throw new ConcurrencyCollisionError(
			`Distribution log ${logId} is already being processed by operation ${existingClaim.operation_id}`
		);
	}

	// Authoritative quantity: after Claim Intent exists, existingClaim.claimed_qty is authoritative
	const authoritativeClaimQty = existingClaim.claimed_qty;
	let claim = existingClaim;

	// Step 2: Pool Effect (Idempotent CAS Quota Claim & schema_v 1 -> 2 Lazy Upgrade)
	targetPool = await poolRepo.get(claim.bulk_pool_id);
	if (!targetPool) {
		throw new WorkflowValidationError(`Bulk return pool ${claim.bulk_pool_id} not found`);
	}

	const poolClaimIds = targetPool.claim_ids ?? [];
	const poolEffectDone = poolClaimIds.includes(claim._id);

	if (!poolEffectDone) {
		try {
			targetPool = await poolRepo.claimQuota(
				claim.bulk_pool_id,
				claim._id,
				authoritativeClaimQty,
				ctx
			);
		} catch (err) {
			// Distinguish deterministic business rejection from transient technical errors
			const isDeterministicRejection =
				err instanceof InsufficientPoolQuotaError ||
				(err instanceof Error &&
					(err.message.includes('Insufficient unclaimed quota') ||
						err.message.includes('not ACTIVE') ||
						err.message.includes('CLOSED') ||
						err.message.includes('EXHAUSTED')));

			if (isDeterministicRejection) {
				try {
					claim = await claimRepo.mutateStatusCAS(claim._id, 'ABORTED', ctx);
				} catch {
					// If abort CAS conflicts, leave claim as is
				}
				throw new InsufficientPoolQuotaError(
					err instanceof Error ? err.message : 'Pool quota exhausted'
				);
			}
			// Transient errors (5xx, network timeout, ConflictError) leave Claim in CLAIM_INTENT for retry
			throw err;
		}
	}

	// Step 3: Advance Claim towards POOL_CLAIMED
	if (claim.status === 'CLAIM_INTENT') {
		claim = await claimRepo.mutateStatusCAS(claim._id, 'POOL_CLAIMED', ctx);
	}

	// Step 4: DistributionLog Effect via CAS
	let updatedLog = await logRepo.get(logId);
	if (!updatedLog) {
		throw new WorkflowValidationError(`Distribution log ${logId} not found`);
	}

	const isLogEffectDone =
		updatedLog.status === 'returned' &&
		updatedLog.clear_reason === 'bulk_dropoff' &&
		updatedLog.bulk_pool_id === claim.bulk_pool_id &&
		updatedLog.qty_returned === updatedLog.qty;

	if (!isLogEffectDone) {
		if (updatedLog.status === 'returned') {
			throw new WorkflowValidationError(
				`Distribution log ${logId} is already marked returned with conflicting attributes`
			);
		}

		const newReturned = addQty(updatedLog.qty_returned ?? '0', authoritativeClaimQty);

		// Section 18: Strict Final Quantity Equality
		if (qtyGt(newReturned, updatedLog.qty)) {
			throw new StockIntegrityError(
				`Over-return detected: resulting returned qty ${newReturned} exceeds issued qty ${updatedLog.qty}`
			);
		}
		if (newReturned !== updatedLog.qty) {
			throw new WorkflowValidationError(
				`Under-return rejected: resulting returned qty ${newReturned} does not equal issued qty ${updatedLog.qty}`
			);
		}

		updatedLog = await logRepo.recordReturn(
			logId,
			{
				qty_returned: newReturned,
				clear_reason: 'bulk_dropoff',
				bulk_pool_id: claim.bulk_pool_id,
				notes: notes || 'Resolved at gate via bulk return pool'
			},
			ctx
		);
	}

	// Step 5: Advance Claim to COMPLETE
	if (claim.status !== 'COMPLETE') {
		claim = await claimRepo.mutateStatusCAS(claim._id, 'COMPLETE', ctx);
	}

	return {
		log: updatedLog,
		pool: targetPool,
		claim
	};
}
