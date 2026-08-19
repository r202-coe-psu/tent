import { describe, expect, it } from 'vitest';
import {
	AppError,
	AuthError,
	ConflictError,
	CouchDocumentPolicyError,
	NetworkError,
	NotFoundError,
	ValidationError,
	buildSaveFailureReport,
	errorMessage,
	formatSaveFailureReport,
	fromPouchError,
	isCouchDocumentPolicyForbidden,
	isPouchError
} from './errors';

describe('isPouchError', () => {
	it('matches on status', () => {
		expect(isPouchError({ status: 404 }, 404)).toBe(true);
		expect(isPouchError({ status: 409 }, 409)).toBe(true);
	});

	it('rejects mismatched status', () => {
		expect(isPouchError({ status: 404 }, 409)).toBe(false);
	});

	it('rejects non-objects', () => {
		expect(isPouchError(null, 404)).toBe(false);
		expect(isPouchError('err', 404)).toBe(false);
	});
});

describe('isCouchDocumentPolicyForbidden', () => {
	it('detects validate_doc_update screening rejection', () => {
		expect(
			isCouchDocumentPolicyForbidden({
				error: 'forbidden',
				reason: 'doc type not allowed yet: screening'
			})
		).toBe(true);
	});

	it('does not treat DB membership forbidden as policy', () => {
		expect(
			isCouchDocumentPolicyForbidden({
				error: 'forbidden',
				reason: 'You are not allowed to access this db.'
			})
		).toBe(false);
	});
});

describe('fromPouchError', () => {
	it('maps 404 → NotFoundError', () => {
		expect(fromPouchError({ status: 404 })).toBeInstanceOf(NotFoundError);
	});

	it('maps 409 → ConflictError', () => {
		expect(fromPouchError({ status: 409 })).toBeInstanceOf(ConflictError);
	});

	it('maps 401 → AuthError(401)', () => {
		const e = fromPouchError({ status: 401 });
		expect(e).toBeInstanceOf(AuthError);
		expect((e as AuthError).status).toBe(401);
	});

	it('maps membership 403 → AuthError(403)', () => {
		const e = fromPouchError({
			status: 403,
			error: 'forbidden',
			reason: 'You are not allowed to access this db.'
		});
		expect(e).toBeInstanceOf(AuthError);
		expect((e as AuthError).status).toBe(403);
	});

	it('maps policy 403 → CouchDocumentPolicyError', () => {
		const e = fromPouchError({
			status: 403,
			error: 'forbidden',
			reason: 'doc type not allowed yet: screening'
		});
		expect(e).toBeInstanceOf(CouchDocumentPolicyError);
		expect((e as CouchDocumentPolicyError).reason).toBe('doc type not allowed yet: screening');
	});

	it('passes AppError through unchanged', () => {
		const original = new NotFoundError('doc1');
		expect(fromPouchError(original)).toBe(original);
	});

	it('wraps unknown errors as UNKNOWN AppError', () => {
		const e = fromPouchError(new Error('boom'));
		expect(e).toBeInstanceOf(AppError);
		expect(e.code).toBe('UNKNOWN');
		expect(e.message).toBe('boom');
	});
});

describe('errorMessage', () => {
	it('NotFoundError → record not found', () => {
		expect(errorMessage(new NotFoundError())).toBe('Record not found');
	});

	it('ConflictError → reload message', () => {
		expect(errorMessage(new ConflictError())).toContain('conflict');
	});

	it('AuthError 401 → session expired', () => {
		expect(errorMessage(new AuthError(401))).toContain('Session expired');
	});

	it('AuthError 403 → permission denied', () => {
		expect(errorMessage(new AuthError(403))).toBe('Permission denied');
	});

	it('CouchDocumentPolicyError → reason', () => {
		expect(
			errorMessage(
				new CouchDocumentPolicyError('x', 403, 'forbidden', 'doc type not allowed yet: screening')
			)
		).toBe('doc type not allowed yet: screening');
	});

	it('ValidationError → its own message', () => {
		expect(errorMessage(new ValidationError('Name is required'))).toBe('Name is required');
	});

	it('NetworkError → no connection', () => {
		expect(errorMessage(new NetworkError())).toBe('No connection');
	});

	it('plain Error → its message', () => {
		expect(errorMessage(new Error('oops'))).toBe('oops');
	});

	it('unknown → fallback', () => {
		expect(errorMessage(42)).toBe('Something went wrong');
	});
});

describe('save failure report', () => {
	it('formats a copyable technical report', () => {
		const report = buildSaveFailureReport(
			new CouchDocumentPolicyError(
				'doc type not allowed yet: screening',
				403,
				'forbidden',
				'doc type not allowed yet: screening',
				'screening:01',
				'screening'
			),
			{
				summaryTh: 'บันทึกไม่สำเร็จ — ระบบปฏิเสธเอกสาร',
				shelterCode: 'SH001',
				rollbackNote: 'compensated'
			}
		);
		const text = formatSaveFailureReport(report);
		expect(text).toContain('บันทึกไม่สำเร็จ');
		expect(text).toContain('http_status: 403');
		expect(text).toContain('couch_error: forbidden');
		expect(text).toContain('reason: doc type not allowed yet: screening');
		expect(text).toContain('doc_id: screening:01');
		expect(text).toContain('shelter_code: SH001');
		expect(text).toContain('rollback: compensated');
	});
});
