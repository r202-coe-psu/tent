/**
 * Application workflow errors for Food & Supplies Distribution.
 */

export class WorkflowError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'WorkflowError';
	}
}

export class WorkflowValidationError extends WorkflowError {
	constructor(message: string) {
		super(message);
		this.name = 'WorkflowValidationError';
	}
}

export class ReservationSemanticMismatchError extends WorkflowValidationError {
	constructor(message: string) {
		super(message);
		this.name = 'ReservationSemanticMismatchError';
	}
}

export class WorkflowAuthorizationError extends WorkflowError {
	constructor(message: string) {
		super(message);
		this.name = 'WorkflowAuthorizationError';
	}
}

export class TicketStateError extends WorkflowError {
	constructor(message: string) {
		super(message);
		this.name = 'TicketStateError';
	}
}

export class CapacityExceededError extends WorkflowError {
	constructor(message: string) {
		super(message);
		this.name = 'CapacityExceededError';
	}
}

export class StockIntegrityError extends WorkflowError {
	constructor(message: string) {
		super(message);
		this.name = 'StockIntegrityError';
	}
}

export class InsufficientPoolQuotaError extends WorkflowError {
	constructor(message: string) {
		super(message);
		this.name = 'InsufficientPoolQuotaError';
	}
}

/** Another OPEN bulk return pool already uses this (normalized) name. Advisory, shown to the user. */
export class BulkReturnPoolNameTakenError extends WorkflowValidationError {
	constructor(message: string) {
		super(message);
		this.name = 'BulkReturnPoolNameTakenError';
	}
}

/**
 * Why a pool refused an operation: `closed` = the pool is no longer OPEN (submitted / received /
 * cancelled), `locked` = OPEN but a submit / cancel is in progress, `not_found` = no such pool.
 * Absent on older throw sites that do not distinguish.
 */
export type BulkReturnPoolStateReason = 'closed' | 'locked' | 'not_found';

/** A bulk return pool is missing, not OPEN, or locked, so the operation cannot proceed. */
export class BulkReturnPoolStateError extends WorkflowError {
	readonly reason?: BulkReturnPoolStateReason;
	constructor(message: string, reason?: BulkReturnPoolStateReason) {
		super(message);
		this.name = 'BulkReturnPoolStateError';
		this.reason = reason;
	}
}

/**
 * The fence waited `POOL_FENCE_SETTLE_TIMEOUT_MS` for a pool's submit / cancel lock to clear and it
 * did not (the other operation is slow or crashed). Nothing about the loans was decided: retrying
 * with the same operationUlid is safe and settles the entry once the lock is gone.
 */
export class BulkReturnPoolLockTimeoutError extends WorkflowError {
	constructor(message: string) {
		super(message);
		this.name = 'BulkReturnPoolLockTimeoutError';
	}
}

/** A pool can only be cancelled when no live entry is in it. */
export class BulkReturnPoolNotEmptyError extends WorkflowError {
	constructor(message: string) {
		super(message);
		this.name = 'BulkReturnPoolNotEmptyError';
	}
}

/** A pool with no live entry (net count 0) cannot be submitted to the warehouse: cancel it instead. */
export class BulkReturnPoolEmptyError extends WorkflowError {
	constructor(message: string) {
		super(message);
		this.name = 'BulkReturnPoolEmptyError';
	}
}

export class ConcurrencyCollisionError extends WorkflowError {
	constructor(message: string) {
		super(message);
		this.name = 'ConcurrencyCollisionError';
	}
}

/**
 * A malformed (schema-invalid) doc that could affect this write was skipped by the read, so the
 * result (a duplicate-meal check, shift totals, a loan allocation, an entry's state) cannot be
 * trusted. The write is refused until the doc is fixed.
 */
export class DistributionDataIntegrityError extends WorkflowError {
	readonly docIds: string[];

	constructor(docIds: string[], context?: string) {
		const named = docIds.map((id) => id || '(unknown id)').join(', ');
		super(`${context ? `${context}: ` : ''}malformed document(s) block this operation: ${named}`);
		this.name = 'DistributionDataIntegrityError';
		this.docIds = docIds;
	}
}

/** Fails closed: throws `DistributionDataIntegrityError` when a write-path read skipped any doc. */
export function assertNoSkippedDocs(skipped: readonly { _id: string }[], context?: string): void {
	if (skipped.length > 0) {
		throw new DistributionDataIntegrityError(
			skipped.map((s) => s._id),
			context
		);
	}
}
