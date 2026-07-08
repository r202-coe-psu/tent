/** True when `err` is a CouchDB HTTP error with the given status code. */
export function isPouchError(err: unknown, status: number): boolean {
	return typeof err === 'object' && err !== null && (err as { status?: number }).status === status;
}

// ----------------------------------------------------------------- typed errors

export class AppError extends Error {
	constructor(
		message: string,
		readonly code: string
	) {
		super(message);
		this.name = 'AppError';
	}
}

export class NotFoundError extends AppError {
	constructor(id?: string) {
		super(id ? `Not found: ${id}` : 'Not found', 'NOT_FOUND');
		this.name = 'NotFoundError';
	}
}

/** CouchDB 409 — write rejected because `_rev` is stale. */
export class ConflictError extends AppError {
	constructor(id?: string) {
		super(id ? `Conflict: ${id}` : 'Document conflict', 'CONFLICT');
		this.name = 'ConflictError';
	}
}

/** 401 = session expired, 403 = insufficient permissions. */
export class AuthError extends AppError {
	constructor(readonly status: 401 | 403 = 401) {
		super(status === 403 ? 'Forbidden' : 'Not authenticated', 'AUTH');
		this.name = 'AuthError';
	}
}

export class ValidationError extends AppError {
	constructor(message: string) {
		super(message, 'VALIDATION');
		this.name = 'ValidationError';
	}
}

export class NetworkError extends AppError {
	constructor() {
		super('Network unavailable', 'NETWORK');
		this.name = 'NetworkError';
	}
}

/** Central CouchDB unreachable after automatic retries (CR-033 disconnected policy). */
export class CannotConnectError extends AppError {
	constructor(message = 'Cannot connect to the server') {
		super(message, 'CANNOT_CONNECT');
		this.name = 'CannotConnectError';
	}
}

/** Alias for auth failures from the active CouchDB endpoint. */
export class CouchAuthError extends AuthError {
	constructor(status: 401 | 403 = 401) {
		super(status);
		this.name = 'CouchAuthError';
	}
}

// ----------------------------------------------------------------- factories

/** Map a raw CouchDB throw into a typed AppError. Re-throws AppErrors unchanged. */
export function fromPouchError(err: unknown): AppError {
	if (err instanceof AppError) return err;
	if (isPouchError(err, 404)) return new NotFoundError();
	if (isPouchError(err, 409)) return new ConflictError();
	if (isPouchError(err, 401)) return new AuthError(401);
	if (isPouchError(err, 403)) return new AuthError(403);
	const message = err instanceof Error ? err.message : 'Unknown error';
	return new AppError(message, 'UNKNOWN');
}

// ----------------------------------------------------------------- UI helpers

/** Human-readable message suitable for a toast notification. */
export function errorMessage(err: unknown): string {
	if (err instanceof NotFoundError) return 'Record not found';
	if (err instanceof ConflictError) return 'Save conflict — reload and try again';
	if (err instanceof AuthError)
		return err.status === 403 ? 'Permission denied' : 'Session expired — please log in again';
	if (err instanceof ValidationError) return err.message;
	if (err instanceof CannotConnectError) return 'Cannot connect — check your network and try again';
	if (err instanceof NetworkError) return 'No connection';
	if (err instanceof Error) return err.message;
	return 'Something went wrong';
}
