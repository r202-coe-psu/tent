import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import type { Cookies } from '@sveltejs/kit';
import { ServiceError } from '$lib/server/couch-admin';
import type { ThaidOAuthState } from '$lib/server/thaid-oauth';

const mockStateRegister: ThaidOAuthState = {
	mode: 'register',
	name: '',
	nonce: 'nonce123',
	returnTo: '/pre-register?shelter=SH001'
};

const mockClaims = {
	sub: 'test-subject',
	name: 'นายสมชาย มั่นคง',
	pid: '1100500123456',
	pid_masked: '1-xxxx-xxxxx-56-6',
	raw: {
		given_name: 'นายสมชาย',
		family_name: 'มั่นคง',
		birthdate: '1985-05-15',
		address: {
			house_no: '123/45',
			village_no: 'หมู่ 2',
			subdistrict: 'ช้างเผือก',
			district: 'เมืองเชียงใหม่',
			province: 'เชียงใหม่',
			postal_code: '50300'
		}
	}
};

const {
	mockClearThaidOAuthStateCookie,
	mockExchangeThaidCode,
	mockParseThaidCitizenClaims,
	mockParseThaidOAuthState,
	mockSetCitizenClaimCookie
} = vi.hoisted(() => ({
	mockClearThaidOAuthStateCookie: vi.fn(),
	mockExchangeThaidCode: vi.fn(),
	mockParseThaidCitizenClaims: vi.fn(),
	mockParseThaidOAuthState: vi.fn(),
	mockSetCitizenClaimCookie: vi.fn()
}));

vi.mock('$lib/server/thaid-oauth', () => ({
	OAUTH_THAID_STATE_COOKIE: 'oauth_thaid_state',
	clearThaidOAuthStateCookie: mockClearThaidOAuthStateCookie,
	exchangeThaidCode: mockExchangeThaidCode,
	getThaidOAuthConfig: vi.fn(() => ({
		clientId: 'mock-client',
		clientSecret: 'mock-secret',
		tokenUrl: 'https://mock.oauth/token'
	})),
	parseThaidCitizenClaims: mockParseThaidCitizenClaims,
	parseThaidOAuthState: mockParseThaidOAuthState,
	resolveThaidLoginUser: vi.fn(),
	resolveThaidRedirectUri: vi.fn(() => 'http://localhost/api/v1/auth/oauth/thaid/callback'),
	setCitizenClaimCookie: mockSetCitizenClaimCookie
}));

vi.mock('$lib/server/google-oauth', () => ({
	fetchCouchAuthHashAlgorithm: vi.fn(),
	fetchCouchAuthSecret: vi.fn(),
	mintAuthSessionCookie: vi.fn(),
	setAuthSessionCookie: vi.fn(),
	setMfaOkCookie: vi.fn()
}));

vi.mock('$lib/server/user-service', () => ({
	findUserByThaidSubject: vi.fn(),
	getThaidMfa: vi.fn(),
	linkThaidMfa: vi.fn(),
	touchThaidMfaVerified: vi.fn()
}));

vi.mock('$lib/db/couch', () => ({
	getSession: vi.fn()
}));

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn(),
	ServiceError: class MockServiceError extends Error {
		code: string;
		constructor(code: string, message: string) {
			super(message);
			this.code = code;
		}
	},
	serviceError: vi.fn()
}));

describe('GET /api/v1/auth/oauth/thaid/callback (mode=register)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function createEvent(urlStr: string, cookieState?: string) {
		const url = new URL(urlStr);
		const cookies = {
			get: vi.fn((name: string) => (name === 'oauth_thaid_state' ? cookieState : undefined)),
			set: vi.fn(),
			delete: vi.fn()
		} as unknown as Cookies;
		const fetchFn = vi.fn() as unknown as typeof fetch;

		return { url, cookies, fetch: fetchFn };
	}

	it('successfully handles mode=register, parses claims, sets claim cookie, and redirects with thaid=autofill', async () => {
		const stateToken = 'signed-state-register';
		mockParseThaidOAuthState.mockReturnValue(mockStateRegister);
		mockExchangeThaidCode.mockResolvedValue(mockClaims);
		mockParseThaidCitizenClaims.mockReturnValue({
			id: 'thaid-1100500123456',
			first_name: 'สมชาย'
		});

		const event = createEvent(
			`http://localhost/api/v1/auth/oauth/thaid/callback?code=auth-code-123&state=${stateToken}`,
			stateToken
		);

		try {
			await GET(event as Parameters<typeof GET>[0]);
			expect.unreachable('Should have thrown redirect');
		} catch (e: unknown) {
			const redir = e as { status: number; location: string };
			expect(redir.status).toBe(302);
			expect(redir.location).toBe('/pre-register?shelter=SH001&thaid=autofill');
			expect(mockExchangeThaidCode).toHaveBeenCalledWith(
				expect.objectContaining({ code: 'auth-code-123' })
			);
			expect(mockSetCitizenClaimCookie).toHaveBeenCalledWith(
				event.cookies,
				expect.objectContaining({ first_name: 'สมชาย' })
			);
		}
	});

	it('redirects to /pre-register with error on invalid/mismatched state when mode=register is detected', async () => {
		const stateToken = 'signed-state-register';
		mockParseThaidOAuthState.mockReturnValue(mockStateRegister);

		// Cookie state differs from stateParam
		const event = createEvent(
			`http://localhost/api/v1/auth/oauth/thaid/callback?code=auth-code-123&state=${stateToken}`,
			'different-cookie-state'
		);

		try {
			await GET(event as Parameters<typeof GET>[0]);
			expect.unreachable('Should have thrown redirect');
		} catch (e: unknown) {
			const redir = e as { status: number; location: string };
			expect(redir.status).toBe(302);
			expect(redir.location).toBe('/pre-register?shelter=SH001&error=invalid_state');
		}
	});

	it('redirects to /pre-register with error when ThaiD returns an error param', async () => {
		const stateToken = 'signed-state-register';
		mockParseThaidOAuthState.mockReturnValue(mockStateRegister);

		const event = createEvent(
			`http://localhost/api/v1/auth/oauth/thaid/callback?error=access_denied&state=${stateToken}`,
			stateToken
		);

		try {
			await GET(event as Parameters<typeof GET>[0]);
			expect.unreachable('Should have thrown redirect');
		} catch (e: unknown) {
			const redir = e as { status: number; location: string };
			expect(redir.status).toBe(302);
			expect(redir.location).toBe('/pre-register?shelter=SH001&error=oauth_access_denied');
		}
	});

	it('redirects to /pre-register when exchangeThaidCode throws ServiceError', async () => {
		const stateToken = 'signed-state-register';
		mockParseThaidOAuthState.mockReturnValue(mockStateRegister);
		mockExchangeThaidCode.mockRejectedValue(new ServiceError('INTERNAL', 'DOPA unreachable'));

		const event = createEvent(
			`http://localhost/api/v1/auth/oauth/thaid/callback?code=bad-code&state=${stateToken}`,
			stateToken
		);

		try {
			await GET(event as Parameters<typeof GET>[0]);
			expect.unreachable('Should have thrown redirect');
		} catch (e: unknown) {
			const redir = e as { status: number; location: string };
			expect(redir.status).toBe(302);
			expect(redir.location).toBe('/pre-register?shelter=SH001&error=oauth_exchange_failed');
		}
	});
});
