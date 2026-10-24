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

/** A bulk return pool is missing, not OPEN, or locked, so the operation cannot proceed. */
export class BulkReturnPoolStateError extends WorkflowError {
	constructor(message: string) {
		super(message);
		this.name = 'BulkReturnPoolStateError';
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
