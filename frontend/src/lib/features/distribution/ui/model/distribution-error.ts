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
