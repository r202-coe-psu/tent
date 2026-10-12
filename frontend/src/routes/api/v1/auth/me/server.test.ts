import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PATCH } from './+server';
import type { RequestEvent } from './$types';
import * as couchAdmin from '$lib/server/couch-admin';
import * as couchDb from '$lib/db/couch';

const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string | undefined> }));

vi.mock('$env/dynamic/private', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$env/dynamic/private')>();
	return { env: Object.assign(mockEnv, actual.env) };
});

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

describe('/api/v1/auth/me +server', () => {
	const mockGetSession = vi.mocked(couchDb.getSession);
	const mockAdminRaw = vi.mocked(couchAdmin.adminRaw);

	beforeEach(() => {
		vi.clearAllMocks();
		delete mockEnv.MFA_STEPUP_ENABLED;
	});

	it('returns 401 when unauthenticated', async () => {
		mockGetSession.mockResolvedValueOnce(null);

		const res = await GET({
			fetch: vi.fn(),
			cookies: { get: vi.fn() }
		} as unknown as RequestEvent);

		expect(res.status).toBe(401);
		const data = await res.json();
		expect(data.error.code).toBe('UNAUTHENTICATED');
	});

	it('marks bootstrap admin as having security question satisfied and cannot change password', async () => {
		mockGetSession.mockResolvedValueOnce({
			name: 'admin',
			roles: ['_admin']
		});
		// CouchDB has no _users doc for bootstrap admin
		mockAdminRaw.mockResolvedValueOnce({
			status: 404,
			data: { error: 'not_found', reason: 'missing' }
		});

		const res = await GET({
			fetch: vi.fn(),
			cookies: { get: vi.fn() }
		} as unknown as RequestEvent);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.name).toBe('admin');
		expect(data.roles).toEqual(['_admin']);
		expect(data.has_security_question).toBe(true);
		expect(data.must_change_password).toBe(false);
		expect(data.pending_mfa).toBe(false);
	});

	it('reflects standard user security_question from _users doc', async () => {
		mockGetSession.mockResolvedValueOnce({
			name: '0812345678',
			roles: ['shelter:SH001', 'registration_staff']
		});
		mockAdminRaw.mockResolvedValueOnce({
			status: 200,
			data: {
				_id: 'org.couchdb.user:0812345678',
				name: '0812345678',
				display_name: 'Test Staff',
				roles: ['shelter:SH001', 'registration_staff'],
				must_change_password: true,
				security_question: null
			}
		});

		const res = await GET({
			fetch: vi.fn(),
			cookies: { get: vi.fn() }
		} as unknown as RequestEvent);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.name).toBe('0812345678');
		expect(data.has_security_question).toBe(false);
		expect(data.must_change_password).toBe(true);
	});

	describe('step-up MFA flag', () => {
		function googleEnrolledUser() {
			mockGetSession.mockResolvedValueOnce({ name: 'staff01', roles: ['shelter:SH001'] });
			mockAdminRaw.mockResolvedValueOnce({
				status: 200,
				data: {
					_id: 'org.couchdb.user:staff01',
					name: 'staff01',
					roles: ['shelter:SH001'],
					must_change_password: false,
					mfa: {
						providers: [{ type: 'google', subject: 'g-1', email: 'staff01@example.com' }]
					}
				}
			});
		}

		it('never reports pending_mfa while step-up is hidden (default)', async () => {
			googleEnrolledUser();
			const res = await GET({
				fetch: vi.fn(),
				cookies: { get: vi.fn() }
			} as unknown as RequestEvent);
			const data = await res.json();
			expect(data.mfa_enrolled).toBe(true);
			expect(data.mfa_providers).toEqual(['google']);
			expect(data.pending_mfa).toBe(false);
		});

		it('reports pending_mfa without mfa_ok when MFA_STEPUP_ENABLED=true', async () => {
			mockEnv.MFA_STEPUP_ENABLED = 'true';
			googleEnrolledUser();
			const res = await GET({
				fetch: vi.fn(),
				cookies: { get: vi.fn() }
			} as unknown as RequestEvent);
			const data = await res.json();
			expect(data.pending_mfa).toBe(true);
		});
	});

	it('rejects PATCH on bootstrap admin with FORBIDDEN', async () => {
		mockGetSession.mockResolvedValueOnce({
			name: 'admin',
			roles: ['_admin']
		});

		const request = new Request('http://localhost/api/v1/auth/me', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ display_name: 'New Name' })
		});

		const res = await PATCH({
			request,
			fetch: vi.fn()
		} as unknown as RequestEvent);

		expect(res.status).toBe(403);
		const data = await res.json();
		expect(data.error.code).toBe('FORBIDDEN');
		expect(data.error.message).toBe('Cannot modify the bootstrap admin user');
	});
});
