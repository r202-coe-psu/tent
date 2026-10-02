import type { AuthorContext } from '$lib/db/model';
import { now } from '$lib/db/model';
import { ulid, isUlid } from '$lib/db/ulid';
import { addQty, parseQty, persistQty, qtyGt, qtyLte, subQty } from '$lib/utils/qty';
import { ConflictError } from '$lib/utils/errors';
import { endpointStore } from '$lib/stores/endpoint.svelte';
import {
	createStockLedger,
	deriveDeterministicLedgerId,
	type OperationsRepository,
	type StockLedger,
	operationsRepository
} from '$lib/features/operations';
import type {
	BulkReturnClaim,
	BulkReturnPool,
	BulkReturnPoolInput,
	DistributionLog,
	LoanReturnReservation,
	LoanReturnReservationMode,
	NonPhysicalClearReason,
	ReturnCondition
} from '../../domain/food-supplies';
import {
	createBulkReturnClaim,
	createBulkReturnPool as createBulkReturnPoolDocument,
	createLoanReturnReservation,
	deriveClaimIdFromDistributionLog,
	deriveReservationIdFromDistributionLog
} from '../../domain/food-supplies';
import {
	BulkReturnClaimRemoteRepository,
	type BulkReturnClaimRepository,
	BulkReturnPoolRemoteRepository,
	type BulkReturnPoolRepository,
	DistributionLogRemoteRepository,
	type DistributionLogRepository,
	LoanReturnReservationRemoteRepository,
	type LoanReturnReservationRepository
} from '../../data/food-supplies';
import {
	assertCanPerformFrontlineDistribution,
	assertCanReceivePhysicalStock,
	assertReservationModeAuthority
} from './auth';
import {
	ConcurrencyCollisionError,
	InsufficientPoolQuotaError,
	ReservationSemanticMismatchError,
	StockIntegrityError,
	WorkflowValidationError
} from './errors';
import { assertLedgerReplayBase } from './ledger-replay';
import { assertPositiveIntegerQty } from './validation';
import { resolveCanonicalItemUnits, type CanonicalUnitCatalogRepository } from './canonical-unit';

function assertCounterReturnLedgerReplay(
	actual: StockLedger,
	expected: StockLedger,
	ctx: AuthorContext
): void {
	assertLedgerReplayBase(
		actual,
		{
			id: expected._id,
			schemaVersion: expected.schema_v,
			shelterCode: ctx.shelterCode,
			reason: 'receive',
			refId: expected.ref_id,
			itemId: expected.item_id,
			qty: expected.qty,
			unit: expected.unit,
			lotRef: expected.lot_ref
		},
		`Counter return ledger replay mismatch for ${expected._id}`
	);
	if (actual.lot?.note !== 'counter_loan_return') {
		throw new StockIntegrityError(`Counter return ledger replay mismatch for ${expected._id}`);
	}
}

function assertRoutineCounterReceiptAccounting(
	entries: StockLedger[],
	log: DistributionLog,
	ctx: AuthorContext,
	unit: string
): void {
	for (const entry of entries) {
		if (
			entry.type !== 'stock_ledger' ||
			entry.shelter_code !== ctx.shelterCode ||
			entry.reason !== 'receive' ||
			entry.ref_id !== log._id ||
			entry.item_id !== log.item_id ||
			entry.unit !== unit ||
			!qtyGt(entry.qty, 0) ||
			(entry.lot_ref !== undefined && entry.lot_ref !== entry._id) ||
			(entry.lot?.note !== undefined && entry.lot.note !== 'counter_loan_return')
		) {
			throw new StockIntegrityError(
				`Invalid routine counter receipt accounting for distribution log ${log._id}`
			);
		}
	}
}

export interface ReturnWorkflowDependencies {
	logRepo?: DistributionLogRepository;
	operationsRepo?: OperationsRepository;
	poolRepo?: BulkReturnPoolRepository;
	claimRepo?: BulkReturnClaimRepository;
	reservationRepo?: LoanReturnReservationRepository;
	endpointStore?: { active: string; isWritable: boolean };
	catalogRepo?: CanonicalUnitCatalogRepository;
}

export interface CounterReturnInput {
	qty_returned: string;
	condition_on_return?: ReturnCondition;
	notes?: string;
	operationUlid?: string;
}

export interface NonPhysicalClearInput {
	clear_reason: 'lost' | 'waived';
	notes: string;
	operationUlid?: string;
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

function isDistributionLogRepository(
	deps: ReturnWorkflowDependencies | DistributionLogRepository | undefined
): deps is DistributionLogRepository {
	return Boolean(
		deps &&
		'get' in deps &&
		'recordClear' in deps &&
		typeof (deps as { get: unknown }).get === 'function' &&
		typeof (deps as { recordClear: unknown }).recordClear === 'function'
	);
}

function resolveDependencies(
	deps: ReturnWorkflowDependencies | DistributionLogRepository | undefined,
	ctx: AuthorContext
): {
	logRepo: DistributionLogRepository;
	operationsRepo: OperationsRepository;
	poolRepo: BulkReturnPoolRepository;
	claimRepo: BulkReturnClaimRepository;
	reservationRepo: LoanReturnReservationRepository;
	endpointStore: { active: string; isWritable: boolean };
} {
	const actualDeps: ReturnWorkflowDependencies | undefined = isDistributionLogRepository(deps)
		? { logRepo: deps }
		: deps;

	return {
		logRepo: actualDeps?.logRepo ?? new DistributionLogRemoteRepository(ctx.shelterCode),
		operationsRepo: actualDeps?.operationsRepo ?? operationsRepository(ctx.shelterCode),
		poolRepo: actualDeps?.poolRepo ?? new BulkReturnPoolRemoteRepository(ctx.shelterCode),
		claimRepo: actualDeps?.claimRepo ?? new BulkReturnClaimRemoteRepository(ctx.shelterCode),
		reservationRepo:
			actualDeps?.reservationRepo ?? new LoanReturnReservationRemoteRepository(ctx.shelterCode),
		endpointStore:
			actualDeps?.endpointStore ??
			(typeof endpointStore !== 'undefined'
				? { active: endpointStore.active, isWritable: endpointStore.status === 'connected' }
				: { active: 'central', isWritable: true })
	};
}

export function assertCentralWriteAuthority(endpoint?: {
	active: string;
	isWritable: boolean;
}): void {
	if (!endpoint || endpoint.active !== 'central' || !endpoint.isWritable) {
		throw new WorkflowValidationError(
			'Authoritative central connectivity is required for loan resolution mutations; edge or disconnected endpoint is not authoritative'
		);
	}
}

/**
 * Authoritatively acquires the shared mutual-exclusion reservation for a return operation.
 * Deterministic per DistributionLog: loan_return_reservation:{distributionLogUlid}.
 * CAS-guarded: enforces single-owner mutual exclusion between PHYSICAL and BULK workflows.
 */
export interface AcquireReturnReservationInput {
	logId: string;
	mode: LoanReturnReservationMode;
	operationId: string;
	operationBy?: string;
	qty_returned?: string;
	return_condition?: ReturnCondition;
	bulk_pool_id?: string;
	claimed_qty?: string;
	clear_reason?: NonPhysicalClearReason;
	notes?: string;
}

export async function acquireReturnReservation(
	input: AcquireReturnReservationInput,
	ctx: AuthorContext,
	deps?: ReturnWorkflowDependencies
): Promise<LoanReturnReservation> {
	assertReservationModeAuthority(input.mode, ctx);
	const { reservationRepo, endpointStore: epStore } = resolveDependencies(deps, ctx);
	assertCentralWriteAuthority(epStore);
	const resId = deriveReservationIdFromDistributionLog(input.logId);

	let existing = await reservationRepo.get(resId);
	if (!existing) {
		const newDoc = createLoanReturnReservation(
			{
				distribution_log_id: input.logId,
				mode: input.mode,
				operation_id: input.operationId,
				operation_by: input.operationBy ?? ctx.createdBy,
				qty_returned: input.qty_returned,
				return_condition: input.return_condition,
				bulk_pool_id: input.bulk_pool_id,
				claimed_qty: input.claimed_qty,
				clear_reason: input.clear_reason,
				notes: input.notes
			},
			ctx
		);
		try {
			return await reservationRepo.create(newDoc);
		} catch (err) {
			if (err instanceof ConflictError) {
				existing = await reservationRepo.get(resId);
				if (!existing) throw err;
			} else {
				throw err;
			}
		}
	}

	if (existing.status === 'RESERVED' || existing.status === 'FENCED') {
		if (existing.operation_id === input.operationId) {
			if (existing.mode !== input.mode) {
				throw new ConcurrencyCollisionError(
					`Distribution log ${input.logId} is currently reserved in ${existing.mode} mode, cannot switch to ${input.mode}`
				);
			}
			// Semantic intent validation for replay
			if (input.mode === 'PHYSICAL') {
				if (input.qty_returned && existing.qty_returned !== input.qty_returned) {
					throw new ReservationSemanticMismatchError(
						`Physical return quantity cannot be modified within the same operation attempt: expected ${existing.qty_returned}, got ${input.qty_returned}`
					);
				}
				if (input.return_condition && existing.return_condition !== input.return_condition) {
					throw new ReservationSemanticMismatchError(
						`Physical return condition cannot be modified within the same operation attempt: expected ${existing.return_condition}, got ${input.return_condition}`
					);
				}
			} else if (input.mode === 'BULK') {
				if (input.bulk_pool_id && existing.bulk_pool_id !== input.bulk_pool_id) {
					throw new ReservationSemanticMismatchError(
						`Bulk pool ID cannot be modified within the same operation attempt: expected ${existing.bulk_pool_id}, got ${input.bulk_pool_id}`
					);
				}
				if (input.claimed_qty && existing.claimed_qty !== input.claimed_qty) {
					throw new ReservationSemanticMismatchError(
						`Bulk claimed quantity cannot be modified within the same operation attempt: expected ${existing.claimed_qty}, got ${input.claimed_qty}`
					);
				}
			} else if (input.mode === 'NON_PHYSICAL') {
				if (input.clear_reason && existing.clear_reason !== input.clear_reason) {
					throw new ReservationSemanticMismatchError(
						`Non-physical clear reason cannot be modified within the same operation attempt: expected ${existing.clear_reason}, got ${input.clear_reason}`
					);
				}
			}
			return existing;
		}
		throw new ConcurrencyCollisionError(
			`Distribution log ${input.logId} is currently reserved for ${existing.mode} return by operation ${existing.operation_id}`
		);
	}

	// Existing reservation is in COMMITTED or ABORTED status; reinitialize for new attempt
	try {
		return await reservationRepo.reinitializeCAS(
			resId,
			{
				operation_id: input.operationId,
				mode: input.mode,
				operation_by: ctx.createdBy,
				qty_returned: input.qty_returned,
				return_condition: input.return_condition,
				bulk_pool_id: input.bulk_pool_id,
				claimed_qty: input.claimed_qty,
				clear_reason: input.clear_reason,
				notes: input.notes
			},
			ctx
		);
	} catch (err) {
		const reloaded = await reservationRepo.get(resId);
		if (
			reloaded &&
			(reloaded.status === 'RESERVED' || reloaded.status === 'FENCED') &&
			(reloaded.mode !== input.mode || reloaded.operation_id !== input.operationId)
		) {
			throw new ConcurrencyCollisionError(
				`Distribution log ${input.logId} was concurrently reserved for ${reloaded.mode} return by operation ${reloaded.operation_id}`
			);
		}
		throw err;
	}
}

/**
 * Authoritatively CAS-fences the reservation right before an irreversible side effect.
 * Freezes ownership and transitions reservation from RESERVED -> FENCED.
 * Guarantees that stale owners or aborted reservations cannot proceed across the effect boundary.
 */
export async function fenceReturnReservation(
	logId: string,
	operationId: string,
	expectedMode: LoanReturnReservationMode,
	ctx: AuthorContext,
	deps?: ReturnWorkflowDependencies
): Promise<LoanReturnReservation> {
	assertReservationModeAuthority(expectedMode, ctx);
	const { reservationRepo, endpointStore: epStore } = resolveDependencies(deps, ctx);
	assertCentralWriteAuthority(epStore);
	const resId = deriveReservationIdFromDistributionLog(logId);
	return reservationRepo.mutateCAS(resId, (current) => {
		if (current.status === 'FENCED') {
			if (current.operation_id === operationId && current.mode === expectedMode) {
				return current;
			}
			throw new ConcurrencyCollisionError(
				`Reservation ${resId} is already fenced by operation ${current.operation_id}`
			);
		}
		if (current.status !== 'RESERVED') {
			throw new ConcurrencyCollisionError(
				`Cannot fence reservation ${resId} in status ${current.status}; expected RESERVED`
			);
		}
		if (current.operation_id !== operationId) {
			throw new ConcurrencyCollisionError(
				`Cannot fence reservation ${resId}: owned by operation ${current.operation_id}, expected ${operationId}`
			);
		}
		if (current.mode !== expectedMode) {
			throw new ConcurrencyCollisionError(
				`Cannot fence reservation ${resId}: mode is ${current.mode}, expected ${expectedMode}`
			);
		}
		return {
			...current,
			status: 'FENCED',
			updated_at: now()
		};
	});
}

/**
 * Commits the return reservation upon successful conclusion of all workflow mutations.
 */
export async function commitReturnReservation(
	logId: string,
	operationId: string,
	ctx: AuthorContext,
	deps?: ReturnWorkflowDependencies
): Promise<LoanReturnReservation> {
	const { reservationRepo, endpointStore: epStore } = resolveDependencies(deps, ctx);
	assertCentralWriteAuthority(epStore);
	const resId = deriveReservationIdFromDistributionLog(logId);
	return reservationRepo.mutateCAS(resId, (current) => {
		if (current.status === 'COMMITTED') {
			return current;
		}
		if (current.status !== 'FENCED') {
			throw new WorkflowValidationError(
				`Cannot commit reservation ${resId} in status ${current.status}; must be FENCED`
			);
		}
		if (current.operation_id !== operationId) {
			throw new ConcurrencyCollisionError(
				`Cannot commit reservation ${resId}: owned by operation ${current.operation_id}, expected ${operationId}`
			);
		}
		assertReservationModeAuthority(current.mode, ctx);
		return {
			...current,
			status: 'COMMITTED',
			updated_at: now()
		};
	});
}

/**
 * Aborts a reservation before irreversible side effects occur.
 */
export async function abortReturnReservation(
	logId: string,
	operationId: string,
	ctx: AuthorContext,
	deps?: ReturnWorkflowDependencies
): Promise<LoanReturnReservation> {
	const { reservationRepo, endpointStore: epStore } = resolveDependencies(deps, ctx);
	assertCentralWriteAuthority(epStore);
	const resId = deriveReservationIdFromDistributionLog(logId);
	return reservationRepo.mutateCAS(resId, (current) => {
		if (current.status === 'ABORTED') {
			return current;
		}
		if (current.status === 'FENCED') {
			throw new ConcurrencyCollisionError(
				`Cannot abort reservation ${resId}: operation is FENCED for execution; must proceed forward`
			);
		}
		if (current.status !== 'RESERVED') {
			return current;
		}
		if (current.operation_id !== operationId) {
			return current;
		}
		assertReservationModeAuthority(current.mode, ctx);
		return {
			...current,
			status: 'ABORTED',
			updated_at: now()
		};
	});
}

/**
 * Returns authoritative operation state and inspects whether in-flight operation is
 * PRE_EFFECT_ABORTABLE or IRREVERSIBLE_FORWARD_ONLY.
 */
export async function getReturnOperationState(
	logId: string,
	ctx: AuthorContext,
	deps?: ReturnWorkflowDependencies
): Promise<{
	reservation: LoanReturnReservation | null;
	claim: BulkReturnClaim | null;
	canAbort: boolean;
	canResume: boolean;
	phase: 'NONE' | 'PRE_EFFECT_ABORTABLE' | 'IRREVERSIBLE_FORWARD_ONLY' | 'TERMINAL';
}> {
	const { reservationRepo, operationsRepo, poolRepo, claimRepo, logRepo } = resolveDependencies(
		deps,
		ctx
	);
	const resId = deriveReservationIdFromDistributionLog(logId);
	const reservation = await reservationRepo.get(resId);
	const claimId = deriveClaimIdFromDistributionLog(logId);
	const claim = await claimRepo.get(claimId);
	const log = await logRepo.get(logId);

	const actorName = ctx.createdBy;
	const isOwner = reservation
		? reservation.operation_by === actorName || reservation.created_by === actorName
		: false;
	const isManagerOrAdmin = Boolean(
		ctx.roles?.some(
			(r) =>
				r === 'shelter_manager' ||
				r === 'system_admin' ||
				r.endsWith(':shelter_manager') ||
				r.endsWith(':system_admin')
		)
	);
	const canAbortPreEffect = isOwner || isManagerOrAdmin;

	if (reservation?.status === 'FENCED') {
		return {
			reservation,
			claim,
			canAbort: false,
			canResume: true,
			phase: 'IRREVERSIBLE_FORWARD_ONLY'
		};
	}

	if (reservation?.status === 'RESERVED') {
		if (reservation.mode === 'PHYSICAL') {
			const existingLedger = await operationsRepo.listLedger();
			const receipts = existingLedger.filter((e) => e.ref_id === logId && e.reason === 'receive');
			if (receipts.length > 0 || (log && log.status === 'returned')) {
				return {
					reservation,
					claim,
					canAbort: false,
					canResume: true,
					phase: 'IRREVERSIBLE_FORWARD_ONLY'
				};
			}
			return {
				reservation,
				claim,
				canAbort: canAbortPreEffect,
				canResume: true,
				phase: 'PRE_EFFECT_ABORTABLE'
			};
		}

		if (reservation.mode === 'NON_PHYSICAL') {
			if (log && ['lost', 'waived'].includes(log.status)) {
				return {
					reservation,
					claim,
					canAbort: false,
					canResume: true,
					phase: 'IRREVERSIBLE_FORWARD_ONLY'
				};
			}
			return {
				reservation,
				claim,
				canAbort: canAbortPreEffect,
				canResume: true,
				phase: 'PRE_EFFECT_ABORTABLE'
			};
		}

		// BULK mode
		if (claim) {
			if (
				claim.status === 'POOL_CLAIMED' ||
				claim.status === 'COMPLETE' ||
				(log && log.status === 'returned')
			) {
				return {
					reservation,
					claim,
					canAbort: false,
					canResume: true,
					phase: 'IRREVERSIBLE_FORWARD_ONLY'
				};
			}
			const pool = await poolRepo.get(claim.bulk_pool_id);
			if (pool && (pool.claim_ids ?? []).includes(claimId)) {
				return {
					reservation,
					claim,
					canAbort: false,
					canResume: true,
					phase: 'IRREVERSIBLE_FORWARD_ONLY'
				};
			}
		}
		return {
			reservation,
			claim,
			canAbort: canAbortPreEffect,
			canResume: true,
			phase: 'PRE_EFFECT_ABORTABLE'
		};
	}

	if (log && ['returned', 'lost', 'waived', 'voided'].includes(log.status)) {
		return { reservation, claim, canAbort: false, canResume: false, phase: 'TERMINAL' };
	}

	return { reservation, claim, canAbort: false, canResume: false, phase: 'NONE' };
}

/**
 * Aborts an abandoned reservation safely. Rejects if irreversible side effects already exist.
 */
export async function abortAbandonedReturnReservation(
	logId: string,
	ctx: AuthorContext,
	deps?: ReturnWorkflowDependencies
): Promise<LoanReturnReservation> {
	const {
		reservationRepo,
		operationsRepo,
		poolRepo,
		claimRepo,
		logRepo,
		endpointStore: epStore
	} = resolveDependencies(deps, ctx);
	assertCentralWriteAuthority(epStore);
	const resId = deriveReservationIdFromDistributionLog(logId);
	const reservation = await reservationRepo.get(resId);
	if (!reservation || reservation.status !== 'RESERVED') {
		if (reservation?.status === 'FENCED') {
			throw new WorkflowValidationError(
				`Cannot abort reservation for log ${logId}: operation is FENCED for ${reservation.mode} execution; must be recovered forward`
			);
		}
		return reservation!;
	}

	// Verify objective abandonment or caller authorization:
	// Allowed if:
	// 1. Caller is the operator who initiated this attempt (operation_by or created_by)
	// 2. Caller is shelter_manager or system_admin
	const abortActorName = ctx.createdBy;
	const isAbortOwner =
		reservation.operation_by === abortActorName || reservation.created_by === abortActorName;
	const isAbortManagerOrAdmin = Boolean(
		ctx.roles?.some(
			(r) =>
				r === 'shelter_manager' ||
				r === 'system_admin' ||
				r.endsWith(':shelter_manager') ||
				r.endsWith(':system_admin')
		)
	);

	if (!isAbortOwner && !isAbortManagerOrAdmin) {
		throw new WorkflowValidationError(
			`Cannot abort active reservation ${resId} owned by ${reservation.operation_by ?? reservation.created_by}; caller is not the owner or a manager/admin`
		);
	}

	if (!isAbortManagerOrAdmin) {
		assertReservationModeAuthority(reservation.mode, ctx);
	}

	if (reservation.mode === 'PHYSICAL') {
		const existingLedger = await operationsRepo.listLedger();
		const receipts = existingLedger.filter((e) => e.ref_id === logId && e.reason === 'receive');
		if (receipts.length > 0) {
			throw new WorkflowValidationError(
				`Cannot abort physical return for log ${logId}: irreversible StockLedger receipt already exists; operation must be recovered forward`
			);
		}
	} else if (reservation.mode === 'BULK') {
		const claimId = deriveClaimIdFromDistributionLog(logId);
		const claim = await claimRepo.get(claimId);
		if (claim) {
			if (claim.status === 'POOL_CLAIMED' || claim.status === 'COMPLETE') {
				throw new WorkflowValidationError(
					`Cannot abort bulk return for log ${logId}: irreversible pool quota deduction already exists; operation must be recovered forward`
				);
			}
			const pool = await poolRepo.get(claim.bulk_pool_id);
			if (pool && (pool.claim_ids ?? []).includes(claimId)) {
				throw new WorkflowValidationError(
					`Cannot abort bulk return for log ${logId}: pool ${pool._id} already contains claim ${claimId}; operation must be recovered forward`
				);
			}
			if (claim.status === 'CLAIM_INTENT') {
				try {
					await claimRepo.mutateStatusCAS(claimId, 'ABORTED', ctx);
				} catch {
					// Best-effort claim cleanup; the reservation state remains authoritative.
				}
			}
		}
	} else if (reservation.mode === 'NON_PHYSICAL') {
		const currentLog = await logRepo.get(logId);
		if (currentLog && ['lost', 'waived', 'returned', 'voided'].includes(currentLog.status)) {
			throw new WorkflowValidationError(
				`Cannot abort non-physical clear for log ${logId}: log is already closed as ${currentLog.status}; operation must be recovered forward`
			);
		}
	}

	return reservationRepo.mutateCAS(resId, (current) => {
		if (current.status === 'ABORTED') {
			return current;
		}
		if (current.status !== 'RESERVED') {
			throw new ConcurrencyCollisionError(
				`Cannot abort reservation ${resId}: status is ${current.status}; must be RESERVED`
			);
		}
		return {
			...current,
			status: 'ABORTED',
			updated_at: now()
		};
	});
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

	assertPositiveIntegerQty(input.qty_returned, 'qty_returned');

	const resolvedDeps = resolveDependencies(deps, ctx);
	const {
		logRepo,
		operationsRepo,
		claimRepo,
		reservationRepo,
		endpointStore: epStore
	} = resolvedDeps;
	assertCentralWriteAuthority(epStore);
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
	if (currentLog.status === 'returned' && currentLog.clear_reason === 'bulk_dropoff') {
		throw new WorkflowValidationError(
			`Distribution log ${logId} was resolved through bulk_dropoff and cannot receive a counter return`
		);
	}
	if (currentLog.status === 'returned' && currentLog.clear_reason !== 'routine') {
		throw new StockIntegrityError(
			`Distribution log ${logId} has unsupported returned clear_reason ${currentLog.clear_reason ?? 'missing'}`
		);
	}
	if (
		currentLog.status === 'returned' &&
		!parseQty(currentLog.qty_returned ?? '0').eq(input.qty_returned)
	) {
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

	// Fail closed if an in-flight bulk return claim exists for this log
	const claimId = deriveClaimIdFromDistributionLog(logId);
	const activeClaim = await claimRepo.get(claimId);
	if (
		activeClaim &&
		(activeClaim.status === 'CLAIM_INTENT' || activeClaim.status === 'POOL_CLAIMED')
	) {
		throw new ConcurrencyCollisionError(
			`Distribution log ${logId} is currently undergoing bulk gate clearance (claim status: ${activeClaim.status})`
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
	const itemUnits = await resolveCanonicalItemUnits([currentLog.item_id], ctx, deps?.catalogRepo);
	const unit = itemUnits.get(currentLog.item_id);
	if (!unit) {
		throw new StockIntegrityError(
			`Missing canonical unit for counter return item ${currentLog.item_id}`
		);
	}
	assertRoutineCounterReceiptAccounting(logReceiveEntries, currentLog, ctx, unit);

	if (qtyGt(totalPreviouslyReceived, input.qty_returned)) {
		throw new StockIntegrityError(
			`Target return quantity (${input.qty_returned}) is lower than physical stock already credited in ledger (${totalPreviouslyReceived}) for log ${logId}`
		);
	}

	// Derive/determine operation ID and inspect existing reservation
	const resId = deriveReservationIdFromDistributionLog(logId);
	const existingRes = await reservationRepo.get(resId);
	const operationId =
		input.operationUlid ??
		((existingRes?.status === 'RESERVED' || existingRes?.status === 'FENCED') &&
		existingRes.mode === 'PHYSICAL'
			? existingRes.operation_id
			: ulid());

	if (currentLog.status === 'returned') {
		if (!parseQty(totalPreviouslyReceived).eq(input.qty_returned)) {
			throw new StockIntegrityError(
				`Routine returned distribution log ${logId} does not match its physical receipt accounting`
			);
		}
		if (
			existingRes &&
			existingRes.mode === 'PHYSICAL' &&
			existingRes.operation_id === operationId
		) {
			if (existingRes.status === 'RESERVED') {
				await fenceReturnReservation(logId, operationId, 'PHYSICAL', ctx, resolvedDeps);
				await commitReturnReservation(logId, operationId, ctx, resolvedDeps);
			} else if (existingRes.status === 'FENCED') {
				await commitReturnReservation(logId, operationId, ctx, resolvedDeps);
			}
		}
		return { log: currentLog, ledgerEntryCreated: false };
	}

	const previousQtyReturned = persistQty(currentLog.qty_returned ?? '0');
	const isAlreadyAtTarget = parseQty(previousQtyReturned).eq(input.qty_returned);
	if (isAlreadyAtTarget) {
		if (!parseQty(totalPreviouslyReceived).eq(previousQtyReturned)) {
			throw new StockIntegrityError(
				`Distribution log ${logId} has mismatched returned and physical receipt quantities`
			);
		}
		if (
			existingRes &&
			existingRes.mode === 'PHYSICAL' &&
			existingRes.operation_id === operationId
		) {
			if (existingRes.status === 'RESERVED') {
				await fenceReturnReservation(logId, operationId, 'PHYSICAL', ctx, resolvedDeps);
				await commitReturnReservation(logId, operationId, ctx, resolvedDeps);
			} else if (existingRes.status === 'FENCED') {
				await commitReturnReservation(logId, operationId, ctx, resolvedDeps);
			}
		}
		return { log: currentLog, ledgerEntryCreated: false };
	}

	const deltaToReceive = subQty(input.qty_returned, previousQtyReturned);
	if (!qtyGt(deltaToReceive, 0)) {
		throw new WorkflowValidationError(
			`qty_returned (${input.qty_returned}) must advance previously returned qty (${previousQtyReturned})`
		);
	}

	await acquireReturnReservation(
		{
			logId,
			mode: 'PHYSICAL',
			operationId,
			notes: input.notes,
			qty_returned: input.qty_returned,
			return_condition: input.condition_on_return
		},
		ctx,
		resolvedDeps
	);

	const ledgerId = await deriveDeterministicLedgerId(
		'counter_return',
		logId,
		'from',
		previousQtyReturned
	);
	const ledgerEntry = createStockLedger(
		{
			item_id: currentLog.item_id,
			qty: deltaToReceive,
			unit,
			reason: 'receive',
			ref_id: logId,
			lot: { note: 'counter_loan_return' },
			occurred_at: now()
		},
		ctx,
		ledgerId
	);

	let ledgerEntryCreated = false;
	// A new receipt may proceed only when prior physical accounting matches the log state.
	// If it already equals the target, the deterministic ledger proves LEDGER_ONLY recovery.
	if (parseQty(totalPreviouslyReceived).eq(previousQtyReturned)) {
		await fenceReturnReservation(logId, operationId, 'PHYSICAL', ctx, resolvedDeps);
		try {
			const persistedLedger = await operationsRepo.addLedgerEntry(ledgerEntry);
			assertCounterReturnLedgerReplay(persistedLedger, ledgerEntry, ctx);
			ledgerEntryCreated = true;
		} catch (error) {
			if (!(error instanceof ConflictError)) {
				throw error;
			}
			const recoveredLedger = await operationsRepo.getLedgerEntry(ledgerId);
			if (!recoveredLedger) {
				throw new StockIntegrityError(
					`ConflictError on ${ledgerId} but existing counter return ledger could not be fetched`
				);
			}
			assertCounterReturnLedgerReplay(recoveredLedger, ledgerEntry, ctx);
		}
	} else if (parseQty(totalPreviouslyReceived).eq(input.qty_returned)) {
		await fenceReturnReservation(logId, operationId, 'PHYSICAL', ctx, resolvedDeps);
		const recoveredLedger = await operationsRepo.getLedgerEntry(ledgerId);
		if (!recoveredLedger) {
			throw new StockIntegrityError(
				`Distribution log ${logId} has unverified physical receipt accounting for counter return recovery`
			);
		}
		assertCounterReturnLedgerReplay(recoveredLedger, ledgerEntry, ctx);
	} else {
		const currentReservation = await reservationRepo.get(resId);
		if (currentReservation?.status === 'RESERVED') {
			try {
				await abortReturnReservation(logId, operationId, ctx, resolvedDeps);
			} catch {
				// Best-effort pre-effect cleanup; preserve the stock-integrity error.
			}
		}
		throw new StockIntegrityError(
			`Distribution log ${logId} has mismatched prior return and physical receipt quantities`
		);
	}

	const updatedLog = await logRepo.recordReturn(
		logId,
		{
			qty_returned: input.qty_returned,
			condition_on_return: input.condition_on_return,
			clear_reason: 'routine',
			notes: input.notes
		},
		ctx
	);

	await commitReturnReservation(logId, operationId, ctx, resolvedDeps);

	return {
		log: updatedLog,
		ledgerEntryCreated
	};
}

/**
 * Clears a loan non-physically as lost or waived (FR-LON-04).
 * Serialized through the shared loan_return_reservation coordinator (NON_PHYSICAL mode).
 * Requires notes. Does NOT create any physical stock receipt or consume bulk pool quota.
 */
export async function clearLoanNonPhysical(
	logId: string,
	input: NonPhysicalClearInput,
	ctx: AuthorContext,
	deps?: ReturnWorkflowDependencies | DistributionLogRepository
): Promise<DistributionLog> {
	assertCanPerformFrontlineDistribution(ctx);

	if (!input.notes || !input.notes.trim()) {
		throw new WorkflowValidationError(
			`notes are required when clearing a loan as ${input.clear_reason}`
		);
	}
	if (input.clear_reason !== 'lost' && input.clear_reason !== 'waived') {
		throw new WorkflowValidationError(
			`Invalid non-physical clear reason '${String(input.clear_reason)}'; must be 'lost' or 'waived'`
		);
	}

	const resolvedDeps = resolveDependencies(deps, ctx);
	const { logRepo, reservationRepo, claimRepo, endpointStore: epStore } = resolvedDeps;
	assertCentralWriteAuthority(epStore);

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
		throw new WorkflowValidationError(`Cannot clear non-returnable distribution log ${logId}`);
	}

	const resId = deriveReservationIdFromDistributionLog(logId);
	const existingRes = await reservationRepo.get(resId);
	const operationId =
		input.operationUlid ??
		((existingRes?.status === 'RESERVED' || existingRes?.status === 'FENCED') &&
		existingRes.mode === 'NON_PHYSICAL'
			? existingRes.operation_id
			: ulid());

	// Crash recovery: if already cleared in this operation, commit and return
	if (currentLog.status === input.clear_reason) {
		if (
			existingRes &&
			existingRes.operation_id === operationId &&
			existingRes.mode === 'NON_PHYSICAL'
		) {
			if (existingRes.status === 'RESERVED') {
				await fenceReturnReservation(logId, operationId, 'NON_PHYSICAL', ctx, resolvedDeps);
				await commitReturnReservation(logId, operationId, ctx, resolvedDeps);
			} else if (existingRes.status === 'FENCED') {
				await commitReturnReservation(logId, operationId, ctx, resolvedDeps);
			}
			return currentLog;
		}
		throw new WorkflowValidationError(
			`Distribution log ${logId} is already closed as ${currentLog.status}`
		);
	}

	if (['returned', 'lost', 'waived', 'voided'].includes(currentLog.status)) {
		throw new WorkflowValidationError(
			`Distribution log ${logId} is already closed as ${currentLog.status}`
		);
	}

	// Fail closed if an active bulk claim exists
	const claimId = deriveClaimIdFromDistributionLog(logId);
	const activeClaim = await claimRepo.get(claimId);
	if (
		activeClaim &&
		(activeClaim.status === 'CLAIM_INTENT' || activeClaim.status === 'POOL_CLAIMED')
	) {
		throw new ConcurrencyCollisionError(
			`Distribution log ${logId} is currently undergoing bulk gate clearance (claim status: ${activeClaim.status})`
		);
	}

	// 1. Acquire shared reservation in NON_PHYSICAL mode
	await acquireReturnReservation(
		{
			logId,
			mode: 'NON_PHYSICAL',
			operationId,
			notes: input.notes,
			clear_reason: input.clear_reason
		},
		ctx,
		resolvedDeps
	);

	// 2. Fenced ownership transition before irreversible DistributionLog clear
	await fenceReturnReservation(logId, operationId, 'NON_PHYSICAL', ctx, resolvedDeps);

	// 3. Irreversible DistributionLog clear
	const updatedLog = await logRepo.recordClear(
		logId,
		{
			clear_reason: input.clear_reason,
			notes: input.notes.trim()
		},
		ctx
	);

	// 4. Commit reservation
	await commitReturnReservation(logId, operationId, ctx, resolvedDeps);

	return updatedLog;
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

	assertPositiveIntegerQty(input.total_received_qty, 'total_received_qty');
	const totalReceivedQty = input.total_received_qty;

	if (!isUlid(input.operationUlid)) {
		throw new WorkflowValidationError('operationUlid must be a valid ULID');
	}

	const { poolRepo, operationsRepo } = resolveDependencies(deps, ctx);
	const itemUnits = await resolveCanonicalItemUnits([input.item_id], ctx, deps?.catalogRepo);
	const unit = itemUnits.get(input.item_id);
	if (!unit) {
		throw new StockIntegrityError(`Missing canonical unit for bulk return item ${input.item_id}`);
	}
	const poolId = `bulk_return_pool:${input.operationUlid}`;
	const ledgerId = `stock_ledger:${input.operationUlid}`;

	// The operation ULID gives one durable identity to the receipt and pool.
	// A retry must reuse it; create-conflict winners are verified below, never adopted blindly.
	const ledgerEntry = createStockLedger(
		{
			item_id: input.item_id,
			qty: totalReceivedQty,
			unit,
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
		total_received_qty: totalReceivedQty,
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
 * Resolves a returnable loan at check-out gate against a Bulk Return Pool quota (FR-LON-04, CR-134).
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

	const {
		logRepo,
		poolRepo,
		claimRepo,
		reservationRepo,
		endpointStore: epStore
	} = resolveDependencies(deps, ctx);
	assertCentralWriteAuthority(epStore);

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
	const reservationId = deriveReservationIdFromDistributionLog(logId);

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
			const resId = deriveReservationIdFromDistributionLog(logId);
			const existingRes = await reservationRepo.get(resId);
			if (
				existingRes &&
				existingRes.mode === 'BULK' &&
				existingRes.operation_id === operationUlid
			) {
				if (existingRes.status === 'RESERVED') {
					await fenceReturnReservation(logId, operationUlid, 'BULK', ctx, deps);
					await commitReturnReservation(logId, operationUlid, ctx, deps);
				} else if (existingRes.status === 'FENCED') {
					await commitReturnReservation(logId, operationUlid, ctx, deps);
				}
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

	// Step 0c: Acquire shared BULK reservation via CAS BEFORE claim doc or pool quota deduction
	await acquireReturnReservation(
		{
			logId,
			mode: 'BULK',
			operationId: operationUlid,
			notes,
			bulk_pool_id: poolId,
			claimed_qty: outstanding
		},
		ctx,
		deps
	);

	// Validation failures may clean up only a still-RESERVED attempt. Once the
	// reservation is FENCED, recovery must continue forward and the original
	// workflow error must not be replaced by an abort-transition error.
	const abortReservationIfPreEffect = async (cleanupClaim?: () => Promise<void>): Promise<void> => {
		const current = await reservationRepo.get(reservationId);
		if (!current || current.status !== 'RESERVED') return;
		if (cleanupClaim) {
			try {
				await cleanupClaim();
			} catch {
				// Best-effort claim cleanup; preserve the original workflow error.
			}
		}
		try {
			await abortReturnReservation(logId, operationUlid, ctx, deps);
		} catch {
			// Best-effort pre-effect cleanup; preserve the original workflow error.
		}
	};

	// Step 0b: Pre-flight Quota Check (Optimization — reject BEFORE creating Claim Doc if pool unusable)
	if (!existingClaim) {
		if (targetPool.status !== 'ACTIVE' || qtyGt(outstanding, targetPool.unclaimed_quota)) {
			await abortReservationIfPreEffect();
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
			await abortReservationIfPreEffect();
			throw new InsufficientPoolQuotaError(
				`Claim for distribution log ${logId} was aborted in operation ${operationUlid}`
			);
		}

		// New operation attempting controlled CAS re-initialization
		if (targetPool.status !== 'ACTIVE' || qtyGt(outstanding, targetPool.unclaimed_quota)) {
			await abortReservationIfPreEffect();
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
				await abortReservationIfPreEffect();
				throw new ConcurrencyCollisionError(
					`Another operation ${reloaded.operation_id} claimed distribution log ${logId} during re-initialization`
				);
			}
			throw err;
		}
	} else if (existingClaim.operation_id !== operationUlid) {
		// Different operation collision on active/effective claim
		await abortReservationIfPreEffect();
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
		// Category B: Error Precedence Guard
		const freshLog = await logRepo.get(logId);
		if (!freshLog) {
			await abortReservationIfPreEffect(async () => {
				claim = await claimRepo.mutateStatusCAS(claim._id, 'ABORTED', ctx);
			});
			throw new WorkflowValidationError(`Distribution log ${logId} not found`);
		}

		// Freshness check: verify DistributionLog state has not changed concurrently
		const isFresh =
			freshLog.is_returnable &&
			(freshLog.status === 'active' || freshLog.status === 'partially_returned') &&
			freshLog.item_id === claim.item_id &&
			parseQty(freshLog.qty).eq(currentLog.qty) &&
			parseQty(freshLog.qty_returned ?? '0').eq(currentLog.qty_returned ?? '0');

		if (!isFresh) {
			await abortReservationIfPreEffect(async () => {
				claim = await claimRepo.mutateStatusCAS(claim._id, 'ABORTED', ctx);
			});
			throw new ConcurrencyCollisionError(
				`Distribution log ${logId} state changed concurrently before pool quota deduction (claim aborted)`
			);
		}

		const newReturned = addQty(freshLog.qty_returned ?? '0', authoritativeClaimQty);

		// Category B: Over-return check (throws StockIntegrityError)
		if (qtyGt(newReturned, freshLog.qty)) {
			await abortReservationIfPreEffect(async () => {
				claim = await claimRepo.mutateStatusCAS(claim._id, 'ABORTED', ctx);
			});
			throw new StockIntegrityError(
				`Over-return detected: resulting returned qty ${newReturned} exceeds issued qty ${freshLog.qty}`
			);
		}

		// Category B: Under-return check (throws WorkflowValidationError)
		if (newReturned !== freshLog.qty) {
			await abortReservationIfPreEffect(async () => {
				claim = await claimRepo.mutateStatusCAS(claim._id, 'ABORTED', ctx);
			});
			throw new WorkflowValidationError(
				`Under-return rejected: resulting returned qty ${newReturned} does not equal issued qty ${freshLog.qty}`
			);
		}

		await fenceReturnReservation(logId, operationUlid, 'BULK', ctx, deps);

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
				throw new InsufficientPoolQuotaError(
					err instanceof Error ? err.message : 'Pool quota exhausted'
				);
			}
			// Transient errors (5xx, network timeout, ConflictError) leave Claim in CLAIM_INTENT for retry
			throw err;
		}
	} else {
		await fenceReturnReservation(logId, operationUlid, 'BULK', ctx, deps);
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

	// Step 6: Commit shared reservation
	await commitReturnReservation(logId, operationUlid, ctx, deps);

	return {
		log: updatedLog,
		pool: targetPool,
		claim
	};
}
