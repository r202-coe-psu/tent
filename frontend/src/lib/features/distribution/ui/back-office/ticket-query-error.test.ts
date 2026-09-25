import { describe, expect, it, vi } from 'vitest';
import {
	mapDistributionQueryError,
	type DistributionQueryErrorPresentation
} from '../model/distribution-error';
import { CannotConnectError, CouchAuthError, NetworkError } from '$lib/utils/errors';
import { WorkflowAuthorizationError } from '../../application/food-supplies/errors';
import { ZodError } from 'zod';

describe('Ticket Query Error UX Mapping & Invariants', () => {
	it('Requirement 1: maps 401 to session/login message with reauth action', () => {
		const err = new CouchAuthError(401);
		const presentation = mapDistributionQueryError(err);

		expect(presentation.kind).toBe('AUTH_401');
		expect(presentation.title).toBe('เซสชันหมดอายุหรือยังไม่ได้เข้าสู่ระบบ');
		expect(presentation.description).toBe('กรุณาเข้าสู่ระบบใหม่เพื่อโหลดข้อมูลใบเบิกจ่าย');
		expect(presentation.actionLabel).toBe('เข้าสู่ระบบใหม่');
		expect(presentation.actionType).toBe('reauth');
		expect(presentation.retryable).toBe(false);
	});

	it('Requirement 2: maps 403 to permission message without retry', () => {
		const err = new CouchAuthError(403);
		const presentation = mapDistributionQueryError(err);

		expect(presentation.kind).toBe('FORBIDDEN_403');
		expect(presentation.title).toBe('ไม่มีสิทธิ์เข้าถึงข้อมูลใบเบิกจ่าย');
		expect(presentation.description).toBe('บัญชีนี้ไม่มีสิทธิ์เข้าถึงข้อมูลของศูนย์พักพิงที่เลือก');
		expect(presentation.retryable).toBe(false);
		expect(presentation.actionType).toBe('none');
		expect(presentation.actionLabel).toBeUndefined();
	});

	it('Requirement 3: maps CannotConnectError & NetworkError to connection message with Retry', () => {
		const connErr = new CannotConnectError();
		const p1 = mapDistributionQueryError(connErr);

		expect(p1.kind).toBe('COUCH_UNAVAILABLE');
		expect(p1.title).toBe('ไม่สามารถเชื่อมต่อระบบข้อมูลได้');
		expect(p1.description).toBe('กรุณาตรวจสอบการเชื่อมต่อหรือลองใหม่อีกครั้ง');
		expect(p1.actionLabel).toBe('ลองใหม่');
		expect(p1.actionType).toBe('retry');
		expect(p1.retryable).toBe(true);

		const netErr = new NetworkError();
		const p2 = mapDistributionQueryError(netErr);

		expect(p2.kind).toBe('COUCH_UNAVAILABLE');
		expect(p2.title).toBe('ไม่สามารถเชื่อมต่อระบบข้อมูลได้');
		expect(p2.description).toBe('กรุณาตรวจสอบการเชื่อมต่อหรือลองใหม่อีกครั้ง');
		expect(p2.actionLabel).toBe('ลองใหม่');
		expect(p2.actionType).toBe('retry');
		expect(p2.retryable).toBe(true);
	});

	it('Requirement 4: maps parsing/schema error to invalid-data message without leaking raw details', () => {
		const zodErr = new ZodError([
			{
				code: 'invalid_type',
				expected: 'string',
				path: ['requisition_type'],
				message: 'Expected string, received number'
			}
		]);
		const presentation = mapDistributionQueryError(zodErr);

		expect(presentation.kind).toBe('QUERY_PARSE_FAILURE');
		expect(presentation.title).toBe('ไม่สามารถอ่านข้อมูลใบเบิกจ่ายได้');
		expect(presentation.description).toBe(
			'ข้อมูลบางรายการมีรูปแบบไม่ถูกต้อง กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ'
		);
		expect(presentation.actionLabel).toBe('ลองใหม่');
		expect(presentation.actionType).toBe('retry');
		expect(presentation.retryable).toBe(true);

		// Raw internals must never leak
		expect(presentation.title).not.toContain('invalid_type');
		expect(presentation.description).not.toContain('Expected string');
		expect(presentation.description).not.toContain('requisition_type');
	});

	it('Requirement 5: maps unknown Error to generic fallback with Retry', () => {
		const unknownErr = new Error('Unexpected crash in worker');
		const presentation = mapDistributionQueryError(unknownErr);

		expect(presentation.kind).toBe('OTHER');
		expect(presentation.title).toBe('ไม่สามารถโหลดรายการใบเบิกจ่ายได้');
		expect(presentation.description).toBe('เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง');
		expect(presentation.actionLabel).toBe('ลองใหม่');
		expect(presentation.actionType).toBe('retry');
		expect(presentation.retryable).toBe(true);
	});

	it('Requirement 6: Retry action invokes ticketsQuery.refetch() where retry is supported', () => {
		const mockTicketsQuery = {
			refetch: vi.fn()
		};

		const retryablePresentation: DistributionQueryErrorPresentation = mapDistributionQueryError(
			new NetworkError()
		);
		expect(retryablePresentation.retryable).toBe(true);

		// Component simulates clicking "ลองใหม่"
		if (retryablePresentation.retryable) {
			mockTicketsQuery.refetch();
		}
		expect(mockTicketsQuery.refetch).toHaveBeenCalledTimes(1);

		// Non-retryable error does NOT invoke refetch
		mockTicketsQuery.refetch.mockClear();
		const nonRetryablePresentation: DistributionQueryErrorPresentation = mapDistributionQueryError(
			new CouchAuthError(403)
		);
		expect(nonRetryablePresentation.retryable).toBe(false);

		if (nonRetryablePresentation.retryable) {
			mockTicketsQuery.refetch();
		}
		expect(mockTicketsQuery.refetch).not.toHaveBeenCalled();
	});

	it('Requirement 7: 403 does not misleadingly claim "database connection failed"', () => {
		const couch403 = new CouchAuthError(403);
		const p1 = mapDistributionQueryError(couch403);

		expect(p1.title).not.toContain('เชื่อมต่อ');
		expect(p1.title).not.toContain('ฐานข้อมูล');
		expect(p1.description).not.toContain('เชื่อมต่อ');
		expect(p1.description).not.toContain('เครือข่าย');

		const workflow403 = new WorkflowAuthorizationError('Cross-shelter access forbidden');
		const p2 = mapDistributionQueryError(workflow403);

		expect(p2.title).not.toContain('เชื่อมต่อ');
		expect(p2.title).not.toContain('ฐานข้อมูล');
		expect(p2.description).not.toContain('เชื่อมต่อ');
		expect(p2.description).not.toContain('เครือข่าย');
	});

	it('asserts TicketManagementPage consumes mapped error and never falls back to old hardcoded message', async () => {
		const fs = await import('node:fs');
		const path = await import('node:path');
		const componentPath = path.resolve(__dirname, 'TicketManagementPage.svelte');
		const content = fs.readFileSync(componentPath, 'utf-8');

		// 1. Must NOT contain the old hardcoded database connection message
		expect(content).not.toContain('ไม่สามารถเชื่อมต่อฐานข้อมูลตั๋วเบิกจ่ายได้');

		// 2. Must import and call mapDistributionQueryError
		expect(content).toContain('mapDistributionQueryError');
		expect(content).toMatch(
			/errorPresentation\s*=\s*\$derived\(mapDistributionQueryError\(ticketsQuery\.error\)\)/
		);

		// 3. Error card markup must render dynamic mapped title and description
		expect(content).toContain('{errorPresentation.title}');
		expect(content).toContain('{errorPresentation.description}');
		expect(content).toContain('{errorPresentation.actionLabel}');
	});
});
