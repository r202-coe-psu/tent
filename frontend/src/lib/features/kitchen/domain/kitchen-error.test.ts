import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
	AuthError,
	CannotConnectError,
	ConflictError,
	CouchDocumentPolicyError,
	NotFoundError
} from '$lib/utils/errors';
import { kitchenErrorReason } from './kitchen-error';

describe('kitchenErrorReason', () => {
	it('does not blame the network for an unreachable or failing server', () => {
		expect(kitchenErrorReason(new CannotConnectError())).toBe(
			'ติดต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง'
		);
	});

	it('leads a document policy rejection in Thai and keeps the raw reason', () => {
		const err = new CouchDocumentPolicyError('x', 403, 'forbidden', 'e2e: plan write rejected');
		expect(kitchenErrorReason(err)).toBe('ระบบปฏิเสธการบันทึก (e2e: plan write rejected)');
	});

	it('passes a Thai reason through unchanged', () => {
		expect(kitchenErrorReason(new Error('"ข้าว" ไม่ใช่รายการในหมวดอาหารปรุงสำเร็จ'))).toBe(
			'"ข้าว" ไม่ใช่รายการในหมวดอาหารปรุงสำเร็จ'
		);
	});

	it('wraps an English error in a Thai reason', () => {
		expect(kitchenErrorReason(new Error('Recipe not found'))).toBe(
			'เกิดข้อผิดพลาดในระบบ (Recipe not found)'
		);
	});

	it.each([
		[new AuthError(403), 'คุณไม่มีสิทธิ์ทำรายการนี้'],
		[new AuthError(401), 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'],
		[new ConflictError(), 'ข้อมูลเปลี่ยนไปแล้ว กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง'],
		[new NotFoundError(), 'ไม่พบข้อมูลที่ต้องการในระบบ'],
		['boom', 'เกิดข้อผิดพลาดในระบบ']
	])('maps %o to a Thai reason', (err, reason) => {
		expect(kitchenErrorReason(err)).toBe(reason);
	});

	it('shows the first schema issue of a validation error', () => {
		const result = z.object({ qty: z.number({ error: 'ระบุจำนวน' }) }).safeParse({});
		expect(kitchenErrorReason(result.error)).toBe('ระบุจำนวน');
	});
});
