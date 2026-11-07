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
});
