import { describe, it, expect, vi } from 'vitest';
import {
	formatDistributionError,
	isUnsafeRawMessage,
	mapDistributionQueryError
} from './distribution-error';
import {
	ConflictError,
	AuthError,
	CouchAuthError,
	ValidationError,
	CannotConnectError,
	NotFoundError,
	CouchDocumentPolicyError,
	NetworkError
} from '$lib/utils/errors';
import { ZodError } from 'zod';
import {
	WorkflowValidationError,
	InsufficientPoolQuotaError,
	ConcurrencyCollisionError,
	TicketStateError,
	CapacityExceededError,
	StockIntegrityError,
	WorkflowAuthorizationError
} from '../../application/food-supplies/errors';

describe('formatDistributionError', () => {
	it('formats typed WorkflowValidationError preserving clean messages', () => {
		const err = new WorkflowValidationError('จำนวนที่คืนต้องมากกว่า 0');
		expect(formatDistributionError(err)).toBe('จำนวนที่คืนต้องมากกว่า 0');
	});

	it('sanitizes WorkflowValidationError when message contains raw JSON leak', () => {
		const err = new WorkflowValidationError('{"error":"bad_request","reason":"invalid"}');
		expect(formatDistributionError(err)).toBe('ข้อมูลที่ระบุไม่ถูกต้องตามเงื่อนไข');
	});

	it('formats InsufficientPoolQuotaError into a user-friendly quota message', () => {
		const err = new InsufficientPoolQuotaError('Insufficient pool quota for clearance');
		expect(formatDistributionError(err)).toContain('จำนวนของที่จุดรวมคืนไม่เพียงพอ');
	});

	it('formats ConcurrencyCollisionError into a user-friendly collision message', () => {
		const err = new ConcurrencyCollisionError('Concurrent reservation in progress');
		expect(formatDistributionError(err)).toContain('รายการนี้กำลังถูกประมวลผลโดยคำขออื่น');
	});

	it('formats TicketStateError into a friendly status mismatch message', () => {
		const err = new TicketStateError('Invalid ticket state');
		expect(formatDistributionError(err)).toBe('สถานะของใบเบิกจ่ายไม่ถูกต้องสำหรับการทำรายการนี้');
	});

	it('formats CapacityExceededError into capacity message', () => {
		const err = new CapacityExceededError('Over capacity');
		expect(formatDistributionError(err)).toBe('จำนวนที่ระบุเกินขีดความสามารถที่รองรับได้');
	});

	it('formats StockIntegrityError into inventory message', () => {
		const err = new StockIntegrityError('Stock mismatch');
		expect(formatDistributionError(err)).toBe(
			'ข้อมูลสต็อกสินค้าไม่สอดคล้อง กรุณาตรวจสอบข้อมูลกับฝ่ายคลัง'
		);
	});

	it('formats WorkflowAuthorizationError into permission message', () => {
		const err = new WorkflowAuthorizationError('Unauthorized action');
		expect(formatDistributionError(err)).toBe('คุณไม่มีสิทธิ์ในการดำเนินการนี้');
	});

	it('formats ConflictError into safe stale data message', () => {
		const err = new ConflictError('doc_123');
		expect(formatDistributionError(err)).toContain('ข้อมูลรายการนี้มีการเปลี่ยนแปลงจากจุดอื่น');
	});

	it('formats CouchDB 409 status into safe stale data message', () => {
		const err = { status: 409, message: 'Document update conflict' };
		expect(formatDistributionError(err)).toContain('ข้อมูลรายการนี้มีการเปลี่ยนแปลงจากจุดอื่น');
	});

	it('formats AuthError 403 into permission message', () => {
		const err = new AuthError(403);
		expect(formatDistributionError(err)).toBe('คุณไม่มีสิทธิ์ในการทำรายการนี้');
	});

	it('formats AuthError 401 into session expired message', () => {
		const err = new AuthError(401);
		expect(formatDistributionError(err)).toBe('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
	});

	it('formats CouchDocumentPolicyError preserving safe reason', () => {
		const err = new CouchDocumentPolicyError(
			'Cannot update closed ticket',
			403,
			'forbidden',
			'ตั๋วถูกปิดรอบแล้ว'
		);
		expect(formatDistributionError(err)).toBe('ระบบปฏิเสธเอกสาร: ตั๋วถูกปิดรอบแล้ว');
	});

	it('sanitizes CouchDocumentPolicyError if reason leaks validate_doc_update or internals', () => {
		const err = new CouchDocumentPolicyError(
			'VDU leak',
			403,
			'forbidden',
			'Error in validate_doc_update function at line 12'
		);
		expect(formatDistributionError(err)).toBe('ระบบปฏิเสธการบันทึกเอกสารตามนโยบายความปลอดภัย');
	});

	it('formats NetworkError into friendly offline message', () => {
		const err = new NetworkError();
		expect(formatDistributionError(err)).toBe(
			'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบสัญญาณเครือข่าย'
		);
	});

	it('formats NotFoundError into not found message', () => {
		const err = new NotFoundError('item_1');
		expect(formatDistributionError(err)).toBe('ไม่พบข้อมูลที่ต้องการในระบบ');
	});

	it('masks raw CouchDB JSON strings', () => {
		const err = new Error('{"error":"internal_server_error","reason":"Internal Server Error"}');
		expect(formatDistributionError(err)).toBe('เกิดข้อผิดพลาดในการทำรายการ กรุณาลองใหม่อีกครั้ง');
	});

	it('masks stack trace leaks', () => {
		const err = new Error(
			'TypeError: Cannot read properties of undefined at Object.mutate (client.js:123:45)'
		);
		expect(formatDistributionError(err)).toBe('เกิดข้อผิดพลาดในการทำรายการ กรุณาลองใหม่อีกครั้ง');
	});

	it('masks database document ID and revision leaks', () => {
		const err = new Error('CouchDB rejected _rev 2-abc12345 for _id ticket_789');
		expect(formatDistributionError(err)).toBe('เกิดข้อผิดพลาดในการทำรายการ กรุณาลองใหม่อีกครั้ง');
	});

	it('preserves clean user-facing Thai messages', () => {
		const err = new Error('จำนวนตรวจรับต้องไม่เกินจำนวนที่ส่งคืน');
		expect(formatDistributionError(err)).toBe('จำนวนตรวจรับต้องไม่เกินจำนวนที่ส่งคืน');
	});

	it('returns custom fallback message when provided for unknown errors', () => {
		const err = { unexpected: 'structure' };
		expect(formatDistributionError(err, 'ข้อความสำรอง')).toBe('ข้อความสำรอง');
	});
});

describe('isUnsafeRawMessage', () => {
	it('identifies JSON objects as unsafe', () => {
		expect(isUnsafeRawMessage('{"status":500}')).toBe(true);
	});

	it('identifies VDU and CouchDB internals as unsafe', () => {
		expect(isUnsafeRawMessage('Error in validate_doc_update')).toBe(true);
		expect(isUnsafeRawMessage('pouchdb-core internal rejection')).toBe(true);
		expect(isUnsafeRawMessage('revision _rev mismatch')).toBe(true);
		expect(isUnsafeRawMessage('TypeError: null is not an object')).toBe(true);
		expect(isUnsafeRawMessage('at Object.fetch (repo.ts:12)')).toBe(true);
	});

	it('allows safe plain messages', () => {
		expect(isUnsafeRawMessage('กรุณาระบุจำนวนที่ถูกต้อง')).toBe(false);
		expect(isUnsafeRawMessage('ไม่พบรายการสินค้าที่ระบุ')).toBe(false);
	});
});

describe('mapDistributionQueryError', () => {
	it('maps 401 CouchAuthError and status 401 to session expired reauth presentation', () => {
		const couchAuthErr = new CouchAuthError(401);
		const result1 = mapDistributionQueryError(couchAuthErr);
		expect(result1.kind).toBe('AUTH_401');
		expect(result1.title).toBe('เซสชันหมดอายุหรือยังไม่ได้เข้าสู่ระบบ');
		expect(result1.description).toBe('กรุณาเข้าสู่ระบบใหม่เพื่อโหลดข้อมูลใบเบิกจ่าย');
		expect(result1.actionLabel).toBe('เข้าสู่ระบบใหม่');
		expect(result1.actionType).toBe('reauth');
		expect(result1.retryable).toBe(false);

		const plain401 = { status: 401, message: 'Unauthorized' };
		const result2 = mapDistributionQueryError(plain401);
		expect(result2.kind).toBe('AUTH_401');
		expect(result2.title).toBe('เซสชันหมดอายุหรือยังไม่ได้เข้าสู่ระบบ');
		expect(result2.actionType).toBe('reauth');
	});

	it('maps 403 authorization error to permission error without retry', () => {
		const couch403 = new CouchAuthError(403);
		const result1 = mapDistributionQueryError(couch403);
		expect(result1.kind).toBe('FORBIDDEN_403');
		expect(result1.title).toBe('ไม่มีสิทธิ์เข้าถึงข้อมูลใบเบิกจ่าย');
		expect(result1.description).toBe('บัญชีนี้ไม่มีสิทธิ์เข้าถึงข้อมูลของศูนย์พักพิงที่เลือก');
		expect(result1.retryable).toBe(false);
		expect(result1.actionType).toBe('none');
		expect(result1.actionLabel).toBeUndefined();

		const workflowAuthErr = new WorkflowAuthorizationError('Unauthorized to access shelter');
		const result2 = mapDistributionQueryError(workflowAuthErr);
		expect(result2.kind).toBe('FORBIDDEN_403');
		expect(result2.title).toBe('ไม่มีสิทธิ์เข้าถึงข้อมูลใบเบิกจ่าย');

		// Invariant: 403 must not claim connection failed
		expect(result1.title).not.toContain('เชื่อมต่อ');
		expect(result2.title).not.toContain('เชื่อมต่อ');
	});

	it('maps CannotConnectError and NetworkError to unavailable connection message with retry', () => {
		const cannotConnectErr = new CannotConnectError();
		const result1 = mapDistributionQueryError(cannotConnectErr);
		expect(result1.kind).toBe('COUCH_UNAVAILABLE');
		expect(result1.title).toBe('ไม่สามารถเชื่อมต่อระบบข้อมูลได้');
		expect(result1.description).toBe('กรุณาตรวจสอบการเชื่อมต่อหรือลองใหม่อีกครั้ง');
		expect(result1.actionLabel).toBe('ลองใหม่');
		expect(result1.actionType).toBe('retry');
		expect(result1.retryable).toBe(true);

		const networkErr = new NetworkError();
		const result2 = mapDistributionQueryError(networkErr);
		expect(result2.kind).toBe('COUCH_UNAVAILABLE');
		expect(result2.title).toBe('ไม่สามารถเชื่อมต่อระบบข้อมูลได้');
		expect(result2.retryable).toBe(true);

		const proxy502 = { status: 502, message: 'Bad Gateway' };
		const result3 = mapDistributionQueryError(proxy502);
		expect(result3.kind).toBe('PROXY_FAILURE');
		expect(result3.title).toBe('ไม่สามารถเชื่อมต่อระบบข้อมูลได้');
		expect(result3.retryable).toBe(true);
	});

	it('maps ZodError and schema parsing failure to invalid data message with retry', () => {
		const zodErr = new ZodError([
			{
				code: 'invalid_type',
				expected: 'string',
				path: ['requisition_type'],
				message: 'Expected string, received number'
			}
		]);
		const result1 = mapDistributionQueryError(zodErr);
		expect(result1.kind).toBe('QUERY_PARSE_FAILURE');
		expect(result1.title).toBe('ไม่สามารถอ่านข้อมูลใบเบิกจ่ายได้');
		expect(result1.description).toBe(
			'ข้อมูลบางรายการมีรูปแบบไม่ถูกต้อง กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ'
		);
		expect(result1.actionLabel).toBe('ลองใหม่');
		expect(result1.actionType).toBe('retry');
		expect(result1.retryable).toBe(true);
		// Invariant: raw internal Zod details must NOT leak into title or description
		expect(result1.title).not.toContain('invalid_type');
		expect(result1.description).not.toContain('Expected string');

		const validationErr = new ValidationError('Malformed document schema');
		const result2 = mapDistributionQueryError(validationErr);
		expect(result2.kind).toBe('QUERY_PARSE_FAILURE');
		expect(result2.title).toBe('ไม่สามารถอ่านข้อมูลใบเบิกจ่ายได้');
	});

	it('maps unknown Error or null to generic fallback message with retry', () => {
		const unknownErr = new Error('Database file corrupted unexpectedly');
		const result1 = mapDistributionQueryError(unknownErr);
		expect(result1.kind).toBe('OTHER');
		expect(result1.title).toBe('ไม่สามารถโหลดรายการใบเบิกจ่ายได้');
		expect(result1.description).toBe('เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง');
		expect(result1.actionLabel).toBe('ลองใหม่');
		expect(result1.actionType).toBe('retry');
		expect(result1.retryable).toBe(true);

		const nullResult = mapDistributionQueryError(null);
		expect(nullResult.kind).toBe('OTHER');
		expect(nullResult.title).toBe('ไม่สามารถโหลดรายการใบเบิกจ่ายได้');
		expect(nullResult.retryable).toBe(true);
	});

	it('supports invoking refetch action when retryable is true', () => {
		const err = new NetworkError();
		const presentation = mapDistributionQueryError(err);
		expect(presentation.retryable).toBe(true);

		const refetchSpy = vi.fn();
		if (presentation.retryable) {
			refetchSpy();
		}
		expect(refetchSpy).toHaveBeenCalledTimes(1);
	});
});
