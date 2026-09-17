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
