import { ZodError } from 'zod';
import {
	AuthError,
	CannotConnectError,
	ConflictError,
	CouchDocumentPolicyError,
	NetworkError,
	NotFoundError
} from '$lib/utils/errors';

const THAI = /[฀-๿]/;

/**
 * Thai reason for a failed kitchen action, to follow "<action>ไม่สำเร็จ: " in a toast. A raw
 * non-Thai detail stays in parentheses so staff can still quote it to support.
 */
export function kitchenErrorReason(err: unknown): string {
	// A CouchDB 5xx surfaces as CannotConnectError after retries, so don't claim the network is down.
	if (err instanceof CannotConnectError || err instanceof NetworkError) {
		return 'ติดต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง';
	}
	if (err instanceof ConflictError) return 'ข้อมูลเปลี่ยนไปแล้ว กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง';
	if (err instanceof NotFoundError) return 'ไม่พบข้อมูลที่ต้องการในระบบ';
	if (err instanceof AuthError) {
		return err.status === 403 ? 'คุณไม่มีสิทธิ์ทำรายการนี้' : 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่';
	}
	if (err instanceof ZodError) return err.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง';

	const isPolicy = err instanceof CouchDocumentPolicyError;
	const raw = (
		isPolicy ? err.reason || err.message : err instanceof Error ? err.message : ''
	).trim();
	if (THAI.test(raw)) return raw;
	const reason = isPolicy ? 'ระบบปฏิเสธการบันทึก' : 'เกิดข้อผิดพลาดในระบบ';
	return raw ? `${reason} (${raw})` : reason;
}
