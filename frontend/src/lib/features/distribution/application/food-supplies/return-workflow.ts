import type { AuthorContext } from '$lib/db/model';
import { now } from '$lib/db/model';
import { isUlid } from '$lib/db/ulid';
import { addQty, parseQty, qtyGt, qtyLte, subQty } from '$lib/utils/qty';
import { ConflictError } from '$lib/utils/errors';
import {
	createStockLedger,
	type OperationsRepository,
	operationsRepository
} from '$lib/features/operations';
import type {
	BulkReturnPool,
	BulkReturnPoolInput,
	DistributionLog,
	ReturnCondition
} from '../../domain/food-supplies';
import { createBulkReturnPool as createBulkReturnPoolDocument } from '../../domain/food-supplies';
import {
	BulkReturnPoolRemoteRepository,
	type BulkReturnPoolRepository,
	DistributionLogRemoteRepository,
	type DistributionLogRepository
} from '../../data/food-supplies';
import { assertCanPerformFrontlineDistribution } from './auth';
import { StockIntegrityError, WorkflowValidationError } from './errors';

export interface ReturnWorkflowDependencies {
	logRepo?: DistributionLogRepository;
	operationsRepo?: OperationsRepository;
	poolRepo?: BulkReturnPoolRepository;
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

function assertBulkPoolLedgerReplay(
	actual: Awaited<ReturnType<OperationsRepository['addLedgerEntry']>>,
	expected: Awaited<ReturnType<typeof createStockLedger>>,
	ctx: AuthorContext
): void {
	if (
		actual._id !== expected._id ||
		actual.type !== 'stock_ledger' ||
		actual.schema_v !== expected.schema_v ||
		actual.shelter_code !== ctx.shelterCode ||
		actual.created_by !== ctx.createdBy ||
		actual.reason !== 'receive' ||
		actual.ref_id !== expected.ref_id ||
		actual.item_id !== expected.item_id ||
		actual.unit !== expected.unit ||
		!parseQty(actual.qty).eq(expected.qty) ||
		actual.lot_ref !== expected._id ||
		actual.lot?.note !== 'bulk_return_pool'
	) {
		throw new StockIntegrityError(`Bulk pool ledger replay mismatch for ${expected._id}`);
	}
}

function assertBulkPoolReplay(
	actual: BulkReturnPool,
	expected: BulkReturnPool,
	ctx: AuthorContext
): void {
	if (
		actual._id !== expected._id ||
		actual.type !== 'bulk_return_pool' ||
		actual.schema_v !== expected.schema_v ||
		actual.shelter_code !== ctx.shelterCode ||
		actual.created_by !== ctx.createdBy ||
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
} {
	return {
		logRepo: deps?.logRepo ?? new DistributionLogRemoteRepository(ctx.shelterCode),
		operationsRepo: deps?.operationsRepo ?? operationsRepository(ctx.shelterCode),
		poolRepo: deps?.poolRepo ?? new BulkReturnPoolRemoteRepository(ctx.shelterCode)
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
	assertCanPerformFrontlineDistribution(ctx);

	const parsed = parseQty(input.qty_returned);
	if (parsed.isNegative() || parsed.isZero()) {
		throw new WorkflowValidationError('qty_returned must be a positive decimal string');
	}

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
	assertCanPerformFrontlineDistribution(ctx);

	const parsed = parseQty(input.total_received_qty);
	if (parsed.isNegative() || parsed.isZero()) {
		throw new WorkflowValidationError('total_received_qty must be a positive decimal string');
	}
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
		assertBulkPoolLedgerReplay(existingLedger, ledgerEntry, ctx);
		assertBulkPoolReplay(existingPool, poolDocument, ctx);
		return existingPool;
	}

	// NONE or LEDGER_ONLY state: attempt to write ledger; recover on conflict
	try {
		const persistedLedger = await operationsRepo.addLedgerEntry(ledgerEntry);
		assertBulkPoolLedgerReplay(persistedLedger, ledgerEntry, ctx);
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
		assertBulkPoolLedgerReplay(recoveredLedger, ledgerEntry, ctx);
	}

	const savedPool = await poolRepo.create(poolDocument, ctx);
	assertBulkPoolReplay(savedPool, poolDocument, ctx);
	return savedPool;
}

/**
 * Resolves a returnable loan at check-out gate against a Bulk Return Pool quota (FR-LON-04).
 * Claims 1 item from pool quota, records bulk_dropoff clear, and creates NO duplicate stock entry.
 */
export async function clearLoanViaBulkPool(
	logId: string,
	poolId: string,
	notes: string | undefined,
	ctx: AuthorContext,
	deps?: ReturnWorkflowDependencies
): Promise<{ log: DistributionLog; pool: BulkReturnPool }> {
	assertCanPerformFrontlineDistribution(ctx);

	const { logRepo, poolRepo } = resolveDependencies(deps, ctx);
	const currentLog = await logRepo.get(logId);
	if (!currentLog) {
		throw new WorkflowValidationError(`Distribution log ${logId} not found`);
	}

	// 1. Claim quota from bulk pool (CAS guarded)
	const claimQty = currentLog.qty || '1';
	const updatedPool = await poolRepo.claimQuota(poolId, claimQty, ctx);

	// 2. Mark log as returned via bulk_dropoff
	const updatedLog = await logRepo.recordReturn(
		logId,
		{
			qty_returned: claimQty,
			clear_reason: 'bulk_dropoff',
			bulk_pool_id: poolId,
			notes: notes || 'Resolved at gate via bulk return pool'
		},
		ctx
	);

	return {
		log: updatedLog,
		pool: updatedPool
	};
}
