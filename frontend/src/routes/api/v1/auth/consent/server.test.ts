import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import * as couchAdmin from '$lib/server/couch-admin';
import * as couchDb from '$lib/db/couch';

vi.mock('$lib/server/couch-admin', async () => {
	const actual =
		await vi.importActual<typeof import('$lib/server/couch-admin')>('$lib/server/couch-admin');
	return {
		...actual,
		adminRaw: vi.fn()
	};
});

vi.mock('$lib/db/couch', async () => {
	const actual = await vi.importActual<typeof import('$lib/db/couch')>('$lib/db/couch');
	return {
		...actual,
		getSession: vi.fn()
	};
});

describe('POST /api/v1/auth/consent', () => {
	const mockGetSession = vi.mocked(couchDb.getSession);
	const mockAdminRaw = vi.mocked(couchAdmin.adminRaw);

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns 401 when unauthenticated', async () => {
		mockGetSession.mockResolvedValueOnce(null);

		const request = new Request('http://localhost/api/v1/auth/consent', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ agreed: true })
		});

		const res = await POST({
			request,
			fetch: vi.fn(),
			cookies: { get: vi.fn() }
		} as unknown as RequestEvent);

		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error?.code).toBe('UNAUTHENTICATED');
	});

	it('returns 422 when agreed is not true', async () => {
		mockGetSession.mockResolvedValueOnce({
			name: 'staff01',
			roles: ['shelter:SH001', 'registration_staff']
		});

		const request = new Request('http://localhost/api/v1/auth/consent', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ agreed: false })
		});

		const res = await POST({
			request,
			fetch: vi.fn(),
			cookies: { get: vi.fn() }
		} as unknown as RequestEvent);

		expect(res.status).toBe(422);
	});

	it('updates user doc and writes audit log to central_ops upon acceptance', async () => {
		mockGetSession.mockResolvedValueOnce({
			name: 'staff01',
			roles: ['shelter:SH001', 'registration_staff']
		});

		// 1. GET user doc
		mockAdminRaw.mockResolvedValueOnce({
			status: 200,
			data: {
				_id: 'org.couchdb.user:staff01',
				_rev: '1-abc',
				name: 'staff01',
				roles: ['shelter:SH001', 'registration_staff'],
				personnel_type: 'staff',
				consent: null
			}
		});

		// 2. PUT updated user doc
		mockAdminRaw.mockResolvedValueOnce({
			status: 201,
			data: { ok: true, id: 'org.couchdb.user:staff01', rev: '2-def' }
		});

		// 3. PUT audit doc in central_ops
		mockAdminRaw.mockResolvedValueOnce({
			status: 201,
			data: { ok: true, id: 'audit:01TESTAUDIT', rev: '1-xyz' }
		});

		const request = new Request('http://localhost/api/v1/auth/consent', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ agreed: true })
		});

		const res = await POST({
			request,
			fetch: vi.fn(),
			cookies: { get: vi.fn() }
		} as unknown as RequestEvent);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.consent.agreed).toBe(true);
		expect(body.consent.version).toBe('1.0');
		expect(typeof body.consent.agreed_at).toBe('string');

		// Check PUT calls
		expect(mockAdminRaw).toHaveBeenCalledWith(
			'/_users/org.couchdb.user:staff01',
			'PUT',
			expect.objectContaining({
				consent: expect.objectContaining({
					agreed: true,
					version: '1.0'
				})
			})
		);

		expect(mockAdminRaw).toHaveBeenCalledWith(
			expect.stringMatching(/^\/central_ops\/audit:/),
			'PUT',
			expect.objectContaining({
				type: 'audit',
				action: 'privacy_change',
				target_type: 'user',
				target_id: 'org.couchdb.user:staff01'
			})
		);
	});

	it('returns 404 when user is soft-deleted', async () => {
		mockGetSession.mockResolvedValueOnce({
			name: 'staff01',
			roles: ['shelter:SH001', 'registration_staff']
		});

		mockAdminRaw.mockResolvedValueOnce({
			status: 200,
			data: {
				_id: 'org.couchdb.user:staff01',
				_rev: '1-abc',
				name: 'staff01',
				roles: ['shelter:SH001', 'registration_staff'],
				personnel_type: 'staff',
				deleted_at: '2026-11-01T00:00:00.000Z'
			}
		});

		const request = new Request('http://localhost/api/v1/auth/consent', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ agreed: true })
		});

		const res = await POST({
			request,
			fetch: vi.fn(),
			cookies: { get: vi.fn() }
		} as unknown as RequestEvent);

		expect(res.status).toBe(404);
	});

	it('returns 500 and rolls back consent update if audit log PUT fails', async () => {
		mockGetSession.mockResolvedValueOnce({
			name: 'staff01',
			roles: ['shelter:SH001', 'registration_staff']
		});

		// 1. GET user doc
		mockAdminRaw.mockResolvedValueOnce({
			status: 200,
			data: {
				_id: 'org.couchdb.user:staff01',
				_rev: '1-abc',
				name: 'staff01',
				roles: ['shelter:SH001', 'registration_staff'],
				personnel_type: 'staff',
				consent: null
			}
		});

		// 2. PUT updated user doc
		mockAdminRaw.mockResolvedValueOnce({
			status: 201,
			data: { ok: true, id: 'org.couchdb.user:staff01', rev: '2-def' }
		});

		// 3. PUT audit doc in central_ops fails
		mockAdminRaw.mockResolvedValueOnce({
			status: 500,
			data: { error: 'internal_server_error' }
		});

		// 4. GET for rollback (readUserDocIncludingDeleted)
		mockAdminRaw.mockResolvedValueOnce({
			status: 200,
			data: {
				_id: 'org.couchdb.user:staff01',
				_rev: '2-def',
				name: 'staff01',
				roles: ['shelter:SH001', 'registration_staff'],
				personnel_type: 'staff',
				consent: { agreed: true, agreed_at: '2026-11-10T00:00:00Z', version: '1.0' }
			}
		});

		// 5. PUT rollback
		mockAdminRaw.mockResolvedValueOnce({
			status: 201,
			data: { ok: true, id: 'org.couchdb.user:staff01', rev: '3-ghi' }
		});

		const request = new Request('http://localhost/api/v1/auth/consent', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ agreed: true })
		});

		const res = await POST({
			request,
			fetch: vi.fn(),
			cookies: { get: vi.fn() }
		} as unknown as RequestEvent);

		expect(res.status).toBe(500);
		expect(mockAdminRaw).toHaveBeenCalledWith(
			'/_users/org.couchdb.user:staff01',
			'PUT',
			expect.objectContaining({
				consent: null
			})
		);
	});
});
