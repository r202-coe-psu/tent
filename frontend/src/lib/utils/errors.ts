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

export type SopMasterIntegrityIssue =
	| 'pointer_missing'
	| 'pointer_malformed'
	| 'profile_missing'
	| 'profile_malformed'
	| 'pointer_target_mismatch'
	| 'pointer_conflicted';

/** Thrown when active SOP master singleton pointer or target profile integrity check fails (CR-079). */
export class SopMasterIntegrityError extends AppError {
	constructor(
		readonly issue: SopMasterIntegrityIssue,
		message: string,
		readonly details?: unknown
	) {
		super(message, 'SOP_MASTER_INTEGRITY');
		this.name = 'SopMasterIntegrityError';
	}
}

/** Alias for auth failures from the active CouchDB endpoint. */
export class CouchAuthError extends AuthError {
	constructor(status: 401 | 403 = 401) {
		super(status);
		this.name = 'CouchAuthError';
	}
}

/**
 * CouchDB 403 from `validate_doc_update` / document policy — not a session
 * failure. Must not trigger `authStore.markNeedsReauth()`.
 */
export class CouchDocumentPolicyError extends AppError {
	constructor(
		message: string,
		readonly status: number = 403,
		readonly couchError?: string,
		readonly reason?: string,
		readonly docId?: string,
		readonly docType?: string
	) {
		super(message, 'DOCUMENT_POLICY');
		this.name = 'CouchDocumentPolicyError';
	}
}

/** Membership / admin-style 403 reasons — treat as auth, not document policy. */
const AUTH_FORBIDDEN_REASON =
	/not allowed to access this db|not a server admin|insufficient|unauthorized|unauthenticated/i;

/**
 * True when a CouchDB 403 body looks like `validate_doc_update` rejection
 * (e.g. `doc type not allowed yet: screening`) rather than missing DB access.
 */
export function isCouchDocumentPolicyForbidden(
	data: {
		error?: string;
		reason?: string;
	} | null
): boolean {
	if (!data) return false;
	const reason = (data.reason ?? '').trim();
	if (!reason) return false;
	if (AUTH_FORBIDDEN_REASON.test(reason)) return false;
	// Couch validate_doc_update uses error "forbidden" with a human reason.
	if (data.error === 'forbidden') return true;
	return (
		/^doc type not allowed/i.test(reason) ||
		/^Cannot (delete|update) append-only/i.test(reason) ||
		/^shelter_code must be/i.test(reason) ||
		/ is required$/i.test(reason) ||
		/^Cannot revert donation/i.test(reason) ||
		/^Only warehouse staff/i.test(reason)
	);
}

// ----------------------------------------------------------------- factories

/** Map a raw CouchDB throw into a typed AppError. Re-throws AppErrors unchanged. */
export function fromPouchError(err: unknown): AppError {
	if (err instanceof AppError) return err;
	if (isPouchError(err, 404)) return new NotFoundError();
	if (isPouchError(err, 409)) return new ConflictError();
	if (isPouchError(err, 401)) return new AuthError(401);
	if (isPouchError(err, 403)) {
		const body = err as { error?: string; reason?: string };
		if (isCouchDocumentPolicyForbidden(body)) {
			return new CouchDocumentPolicyError(
				body.reason || 'Document policy rejected the write',
				403,
				body.error,
				body.reason
			);
		}
		return new AuthError(403);
	}
	const message = err instanceof Error ? err.message : 'Unknown error';
	return new AppError(message, 'UNKNOWN');
}

// ----------------------------------------------------------------- UI helpers

/** Human-readable message suitable for a toast notification. */
export function errorMessage(err: unknown): string {
	if (err instanceof NotFoundError) return 'Record not found';
	if (err instanceof ConflictError) return 'Save conflict — reload and try again';
	if (err instanceof CouchDocumentPolicyError)
		return err.reason || err.message || 'ระบบปฏิเสธเอกสาร';
	if (err instanceof AuthError)
		return err.status === 403 ? 'Permission denied' : 'Session expired — please log in again';
	if (err instanceof ValidationError) return err.message;
	if (err instanceof CannotConnectError) return 'Cannot connect — check your network and try again';
	if (err instanceof NetworkError) return 'No connection';
	if (err instanceof Error) return err.message;
	return 'Something went wrong';
}

/** Structured report for staff to copy when a registration save unit fails. */
export type SaveFailureReport = {
	summaryTh: string;
	httpStatus?: number;
	couchError?: string;
	reason?: string;
	docId?: string;
	docType?: string;
	shelterCode?: string;
	timestamp: string;
	rollbackNote?: string;
};

export function buildSaveFailureReport(
	err: unknown,
	opts: {
		summaryTh?: string;
		shelterCode?: string;
		rollbackNote?: string;
		docId?: string;
		docType?: string;
	} = {}
): SaveFailureReport {
	const timestamp = new Date().toISOString();
	const summaryTh = opts.summaryTh ?? 'บันทึกไม่สำเร็จ — ระบบปฏิเสธเอกสาร';

	if (err instanceof CouchDocumentPolicyError) {
		return {
			summaryTh,
			httpStatus: err.status,
			couchError: err.couchError ?? 'forbidden',
			reason: err.reason ?? err.message,
			docId: opts.docId ?? err.docId,
			docType: opts.docType ?? err.docType,
			shelterCode: opts.shelterCode,
			timestamp,
			rollbackNote: opts.rollbackNote
		};
	}

	const status =
		typeof err === 'object' && err !== null && 'status' in err
			? Number((err as { status: unknown }).status)
			: undefined;
	const reason =
		err instanceof Error
			? err.message
			: typeof err === 'object' && err !== null && 'reason' in err
				? String((err as { reason: unknown }).reason)
				: String(err);

	return {
		summaryTh,
		httpStatus: Number.isFinite(status) ? status : undefined,
		couchError:
			typeof err === 'object' && err !== null && 'couchError' in err
				? String((err as { couchError: unknown }).couchError)
				: undefined,
		reason,
		docId: opts.docId,
		docType: opts.docType,
		shelterCode: opts.shelterCode,
		timestamp,
		rollbackNote: opts.rollbackNote
	};
}

/** Plain-text payload for clipboard / support tickets. */
export function formatSaveFailureReport(report: SaveFailureReport): string {
	const lines = [
		report.summaryTh,
		`timestamp: ${report.timestamp}`,
		report.httpStatus != null ? `http_status: ${report.httpStatus}` : null,
		report.couchError ? `couch_error: ${report.couchError}` : null,
		report.reason ? `reason: ${report.reason}` : null,
		report.docType ? `doc_type: ${report.docType}` : null,
		report.docId ? `doc_id: ${report.docId}` : null,
		report.shelterCode ? `shelter_code: ${report.shelterCode}` : null,
		report.rollbackNote ? `rollback: ${report.rollbackNote}` : null
	];
	return lines.filter((line): line is string => line != null && line.length > 0).join('\n');
}
