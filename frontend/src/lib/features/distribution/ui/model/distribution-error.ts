import {
	ConflictError,
	AuthError,
	ValidationError,
	CannotConnectError,
	NetworkError,
	NotFoundError,
	CouchDocumentPolicyError,
	isPouchError
} from '$lib/utils/errors';
import {
	WorkflowValidationError,
	ReservationSemanticMismatchError,
	WorkflowAuthorizationError,
	TicketStateError,
	CapacityExceededError,
	StockIntegrityError,
	InsufficientPoolQuotaError,
	ConcurrencyCollisionError
} from '../../application/food-supplies/errors';
import { ZodError } from 'zod';

/**
 * Checks whether an error message is potentially unsafe (internal CouchDB leak, JSON, stack trace, etc.)
 */
export function isUnsafeRawMessage(msg: string): boolean {
	if (!msg) return true;
	const trimmed = msg.trim();
	// JSON payload leak (e.g. {"error":"...","reason":"..."})
	if (trimmed.startsWith('{') && trimmed.endsWith('}')) return true;
	// CouchDB / PouchDB / VDU / Stack trace / Database internals
	if (
		/validate_doc_update|pouchdb|couchdb|_design|_local|\bdoc\b|\brevision\b|_rev|_id|at\s+\S+\s+\(|syntaxerror|typeerror|referenceerror|rangeerror/i.test(
			trimmed
		)
	) {
		return true;
	}
	return false;
}

/**
 * Formats an unknown error into a safe, human-friendly user message.
 * Strictly prevents exposure of CouchDB internals, VDU logic, stack traces, and database identifiers,
 * while preserving safe typed domain/application validation and workflow messages.
 */
export function formatDistributionError(
	err: unknown,
	fallbackMessage = 'เกิดข้อผิดพลาดในการทำรายการ กรุณาลองใหม่อีกครั้ง'
): string {
	if (!err) return fallbackMessage;

	// 1. Distribution Workflow Typed Errors
	if (err instanceof WorkflowValidationError || err instanceof ReservationSemanticMismatchError) {
		if (err.message && !isUnsafeRawMessage(err.message)) {
			return err.message;
		}
		return 'ข้อมูลที่ระบุไม่ถูกต้องตามเงื่อนไข';
	}

	if (err instanceof InsufficientPoolQuotaError) {
		return 'จำนวนของที่จุดรวมคืนไม่เพียงพอหรือมีการเปลี่ยนแปลงจากจุดอื่น กรุณาตรวจสอบจำนวนล่าสุดแล้วลองใหม่';
	}

	if (err instanceof ConcurrencyCollisionError) {
		return 'รายการนี้กำลังถูกประมวลผลโดยคำขออื่น กรุณารอสักครู่แล้วตรวจสอบสถานะล่าสุดก่อนลองใหม่';
	}

	if (err instanceof TicketStateError) {
		return 'สถานะของใบเบิกจ่ายไม่ถูกต้องสำหรับการทำรายการนี้';
	}

	if (err instanceof CapacityExceededError) {
		return 'จำนวนที่ระบุเกินขีดความสามารถที่รองรับได้';
	}

	if (err instanceof StockIntegrityError) {
		return 'ข้อมูลสต็อกสินค้าไม่สอดคล้อง กรุณาตรวจสอบข้อมูลกับฝ่ายคลัง';
	}

	if (err instanceof WorkflowAuthorizationError) {
		return 'คุณไม่มีสิทธิ์ในการดำเนินการนี้';
	}

	// 2. Core Repository / CouchDB App Errors
	if (err instanceof ConflictError || isPouchError(err, 409)) {
		return 'ข้อมูลรายการนี้มีการเปลี่ยนแปลงจากจุดอื่น กรุณาตรวจสอบยอดล่าสุดก่อนทำรายการใหม่';
	}

	if (err instanceof CouchDocumentPolicyError) {
		const reason = err.reason || err.message;
		if (reason && !isUnsafeRawMessage(reason)) {
			return `ระบบปฏิเสธเอกสาร: ${reason}`;
		}
		return 'ระบบปฏิเสธการบันทึกเอกสารตามนโยบายความปลอดภัย';
	}

	if (err instanceof AuthError || isPouchError(err, 401) || isPouchError(err, 403)) {
		const status = (err as { status?: number }).status;
		return status === 403 ? 'คุณไม่มีสิทธิ์ในการทำรายการนี้' : 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';
	}

	if (err instanceof ValidationError) {
		if (err.message && !isUnsafeRawMessage(err.message)) {
			return err.message;
		}
		return 'ข้อมูลที่ระบุไม่ถูกต้อง';
	}

	if (err instanceof NotFoundError || isPouchError(err, 404)) {
		return 'ไม่พบข้อมูลที่ต้องการในระบบ';
	}

	if (err instanceof CannotConnectError || err instanceof NetworkError) {
		return 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบสัญญาณเครือข่าย';
	}

	// 3. String / General Error inspections
	const rawMessage =
		err instanceof Error
			? err.message
			: typeof err === 'string'
				? err
				: typeof err === 'object' && err !== null && 'message' in err
					? String((err as { message: unknown }).message)
					: '';

	if (rawMessage) {
		// Specific known domain substring matching (in case an error was wrapped in standard Error)
		if (/conflict|409/i.test(rawMessage)) {
			return 'ข้อมูลรายการนี้มีการเปลี่ยนแปลงจากจุดอื่น กรุณาตรวจสอบยอดล่าสุดก่อนทำรายการใหม่';
		}
		if (/unclaimed quota|insufficient.*quota|EXHAUSTED|CLOSED/i.test(rawMessage)) {
			return 'จำนวนของที่จุดรวมคืนไม่เพียงพอหรือมีการเปลี่ยนแปลงจากจุดอื่น กรุณาตรวจสอบจำนวนล่าสุดแล้วลองใหม่';
		}
		if (/being processed|concurrency/i.test(rawMessage)) {
			return 'รายการนี้กำลังถูกประมวลผลโดยคำขออื่น กรุณารอสักครู่แล้วตรวจสอบสถานะล่าสุดก่อนลองใหม่';
		}
		if (/Cross-shelter access denied|forbidden|unauthorized/i.test(rawMessage)) {
			return 'คุณไม่มีสิทธิ์ในการเข้าถึงข้อมูลข้ามศูนย์พักพิง';
		}
		if (/Network unavailable|failed to fetch|cannot connect/i.test(rawMessage)) {
			return 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบสัญญาณเครือข่าย';
		}

		// If message is clean (e.g. Thai text or user validation string) and not technical leak:
		if (!isUnsafeRawMessage(rawMessage)) {
			return rawMessage;
		}
	}

	return fallbackMessage;
}

export type DistributionQueryErrorKind =
	| 'AUTH_401'
	| 'FORBIDDEN_403'
	| 'COUCH_UNAVAILABLE'
	| 'PROXY_FAILURE'
	| 'QUERY_PARSE_FAILURE'
	| 'OTHER';

export interface DistributionQueryErrorPresentation {
	kind: DistributionQueryErrorKind;
	title: string;
	description: string;
	retryable: boolean;
	actionLabel?: string;
	actionType: 'retry' | 'reauth' | 'none';
}

function extractErrorStatus(err: unknown): number | undefined {
	if (typeof err === 'object' && err !== null) {
		if ('status' in err && typeof (err as { status: unknown }).status === 'number') {
			return (err as { status: number }).status;
		}
		if ('statusCode' in err && typeof (err as { statusCode: unknown }).statusCode === 'number') {
			return (err as { statusCode: number }).statusCode;
		}
	}
	if (err instanceof AuthError) {
		return err.status;
	}
	return undefined;
}

function extractErrorCode(err: unknown): string | undefined {
	if (
		typeof err === 'object' &&
		err !== null &&
		'code' in err &&
		typeof (err as { code: unknown }).code === 'string'
	) {
		return (err as { code: string }).code;
	}
	return undefined;
}

function extractErrorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (typeof err === 'string') return err;
	if (typeof err === 'object' && err !== null && 'message' in err) {
		return String((err as { message: unknown }).message);
	}
	return '';
}

/**
 * Maps query-level read errors (e.g. from TanStack useRequisitionTickets)
 * into a safe, human-friendly Thai error presentation for UI cards/banners.
 *
 * Distinguishes 401 (Session), 403 (Permission), Database/Network/Proxy unavailable,
 * and schema/parsing failures without exposing internal CouchDB/Zod leaks.
 */
export function mapDistributionQueryError(err: unknown): DistributionQueryErrorPresentation {
	if (!err) {
		return {
			kind: 'OTHER',
			title: 'ไม่สามารถโหลดรายการใบเบิกจ่ายได้',
			description: 'เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง',
			retryable: true,
			actionType: 'retry',
			actionLabel: 'ลองใหม่'
		};
	}

	const status = extractErrorStatus(err);
	const code = extractErrorCode(err);
	const rawMessage = extractErrorMessage(err);

	// 1. Permission Error — HTTP 403
	if (
		status === 403 ||
		err instanceof WorkflowAuthorizationError ||
		err instanceof CouchDocumentPolicyError ||
		(err instanceof AuthError && err.status === 403) ||
		(code === 'AUTH' && status === 403) ||
		isPouchError(err, 403) ||
		(status === undefined &&
			/\b403\b|forbidden|cross-shelter access denied|unauthorized to access/i.test(rawMessage))
	) {
		return {
			kind: 'FORBIDDEN_403',
			title: 'ไม่มีสิทธิ์เข้าถึงข้อมูลใบเบิกจ่าย',
			description: 'บัญชีนี้ไม่มีสิทธิ์เข้าถึงข้อมูลของศูนย์พักพิงที่เลือก',
			retryable: false,
			actionType: 'none',
			actionLabel: undefined
		};
	}

	// 2. Authentication / Session Error — HTTP 401
	if (
		status === 401 ||
		(err instanceof AuthError && err.status === 401) ||
		(code === 'AUTH' && status === 401) ||
		isPouchError(err, 401) ||
		(status === undefined &&
			/\b401\b|unauthorized|session expired|เซสชันหมดอายุ/i.test(rawMessage) &&
			!/\b403\b|forbidden/i.test(rawMessage))
	) {
		return {
			kind: 'AUTH_401',
			title: 'เซสชันหมดอายุหรือยังไม่ได้เข้าสู่ระบบ',
			description: 'กรุณาเข้าสู่ระบบใหม่เพื่อโหลดข้อมูลใบเบิกจ่าย',
			retryable: false,
			actionType: 'reauth',
			actionLabel: 'เข้าสู่ระบบใหม่'
		};
	}

	// 3. Database / Network / Proxy Unavailable
	const isProxy = status === 502 || status === 504 || /(?:proxy|bad gateway)/i.test(rawMessage);
	const isUnavailable =
		isProxy ||
		err instanceof CannotConnectError ||
		err instanceof NetworkError ||
		code === 'CANNOT_CONNECT' ||
		code === 'NETWORK' ||
		status === 0 ||
		(status !== undefined && status >= 500) ||
		/(?:network unavailable|failed to fetch|cannot connect|connection refused|econnrefused)/i.test(
			rawMessage
		);

	if (isUnavailable) {
		return {
			kind: isProxy ? 'PROXY_FAILURE' : 'COUCH_UNAVAILABLE',
			title: 'ไม่สามารถเชื่อมต่อระบบข้อมูลได้',
			description: 'กรุณาตรวจสอบการเชื่อมต่อหรือลองใหม่อีกครั้ง',
			retryable: true,
			actionType: 'retry',
			actionLabel: 'ลองใหม่'
		};
	}

	// 4. Invalid / Unexpected Returned Data (Schema / Zod / Parse failure)
	const isParseFailure =
		err instanceof ZodError ||
		(typeof err === 'object' &&
			err !== null &&
			((err as { name?: string }).name === 'ZodError' ||
				Array.isArray((err as { issues?: unknown }).issues))) ||
		err instanceof ValidationError ||
		code === 'VALIDATION' ||
		err instanceof SyntaxError ||
		/(?:zod|schema|parse error|malformed.*document)/i.test(rawMessage);

	if (isParseFailure) {
		return {
			kind: 'QUERY_PARSE_FAILURE',
			title: 'ไม่สามารถอ่านข้อมูลใบเบิกจ่ายได้',
			description: 'ข้อมูลบางรายการมีรูปแบบไม่ถูกต้อง กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ',
			retryable: true,
			actionType: 'retry',
			actionLabel: 'ลองใหม่'
		};
	}

	// 5. Unknown Error / Fallback
	return {
		kind: 'OTHER',
		title: 'ไม่สามารถโหลดรายการใบเบิกจ่ายได้',
		description: 'เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง',
		retryable: true,
		actionType: 'retry',
		actionLabel: 'ลองใหม่'
	};
}
