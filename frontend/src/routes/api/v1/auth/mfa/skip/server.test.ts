import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import * as couchDb from '$lib/db/couch';
import * as googleOAuth from '$lib/server/google-oauth';

vi.mock('$lib/db/couch', async () => {
	const actual = await vi.importActual<typeof import('$lib/db/couch')>('$lib/db/couch');
	return {
		...actual,
		getSession: vi.fn()
	};
});

vi.mock('$lib/server/google-oauth', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/google-oauth')>(
		'$lib/server/google-oauth'
	);
	return {
		...actual,
		setMfaOkCookie: vi.fn()
	};
});

describe('POST /api/v1/auth/mfa/skip', () => {
	const mockGetSession = vi.mocked(couchDb.getSession);
	const mockSetMfaOkCookie = vi.mocked(googleOAuth.setMfaOkCookie);

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns 401 when unauthenticated', async () => {
		mockGetSession.mockResolvedValueOnce(null);

		const res = await POST({
			fetch: vi.fn(),
			cookies: {} as never
		} as unknown as RequestEvent);

		expect(res.status).toBe(401);
		const data = await res.json();
		expect(data.error.code).toBe('UNAUTHENTICATED');
		expect(mockSetMfaOkCookie).not.toHaveBeenCalled();
	});

	it('sets mfa_ok cookie and returns 200 ok when authenticated', async () => {
		mockGetSession.mockResolvedValueOnce({
			name: 'staff01',
			roles: ['shelter:SH001']
		});
		const mockCookies = {} as never;

		const res = await POST({
			fetch: vi.fn(),
			cookies: mockCookies
		} as unknown as RequestEvent);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toEqual({ ok: true });
		expect(mockSetMfaOkCookie).toHaveBeenCalledWith(mockCookies, 'staff01');
	});
});
