import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import type { Cookies } from '@sveltejs/kit';
import { ServiceError } from '$lib/server/couch-admin';
import type { ThaidOAuthState } from '$lib/server/thaid-oauth';
import {
	_resetSessionsForTest,
	cancelKioskSession,
	createKioskCheckInSession,
	createScanSession,
	getKioskSessionForDevice,
	getScanSession
} from '$lib/server/thaid-scan-session';

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
	mockSetCitizenClaimCookie,
	mockResolveThaidLoginUser,
	mockFindUserByThaidSubject,
	mockSetPendingLinkCookie
} = vi.hoisted(() => ({
	mockResolveThaidLoginUser: vi.fn(),
	mockFindUserByThaidSubject: vi.fn(),
	mockSetPendingLinkCookie: vi.fn(),
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
	resolveThaidLoginUser: mockResolveThaidLoginUser,
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
	findUserByThaidSubject: mockFindUserByThaidSubject,
	getThaidMfa: vi.fn(),
	linkThaidMfa: vi.fn(),
	touchThaidMfaVerified: vi.fn()
}));

vi.mock('$lib/server/pending-link', () => ({
	setPendingLinkCookie: mockSetPendingLinkCookie
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

describe('GET /api/v1/auth/oauth/thaid/callback (mode=login, CR-141)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function loginEvent(state: string) {
		return {
			url: new URL(`http://localhost/api/v1/auth/oauth/thaid/callback?code=c&state=${state}`),
			cookies: {
				get: vi.fn((name: string) => (name === 'oauth_thaid_state' ? state : undefined)),
				set: vi.fn(),
				delete: vi.fn()
			} as unknown as Cookies,
			fetch: vi.fn() as unknown as typeof fetch
		};
	}

	it('not linked → sets pending_link and redirects to /login/link', async () => {
		mockParseThaidOAuthState.mockReturnValue({ mode: 'login', name: '', nonce: 'n' });
		mockExchangeThaidCode.mockResolvedValue(mockClaims);
		mockFindUserByThaidSubject.mockResolvedValue(null);
		mockResolveThaidLoginUser.mockReturnValue({ ok: false, reason: 'thaid_not_linked' });
		const event = loginEvent('s-login');

		try {
			await GET(event as Parameters<typeof GET>[0]);
			expect.unreachable('Should have thrown redirect');
		} catch (e: unknown) {
			const redir = e as { status: number; location: string };
			expect(redir.status).toBe(302);
			expect(redir.location).toBe('/login/link');
			expect(mockSetPendingLinkCookie).toHaveBeenCalledWith(event.cookies, {
				provider: 'thaid',
				sub: 'test-subject',
				name: 'นายสมชาย มั่นคง',
				pid_masked: '1-xxxx-xxxxx-56-6'
			});
		}
	});

	it('missing salt → still a login error, no pending link', async () => {
		mockParseThaidOAuthState.mockReturnValue({ mode: 'login', name: '', nonce: 'n' });
		mockExchangeThaidCode.mockResolvedValue(mockClaims);
		mockFindUserByThaidSubject.mockResolvedValue({ name: 'x' });
		mockResolveThaidLoginUser.mockReturnValue({ ok: false, reason: 'missing_salt' });

		try {
			await GET(loginEvent('s-login') as Parameters<typeof GET>[0]);
			expect.unreachable('Should have thrown redirect');
		} catch (e: unknown) {
			const redir = e as { status: number; location: string };
			expect(redir.location).toBe('/login?error=thaid_login_failed');
			expect(mockSetPendingLinkCookie).not.toHaveBeenCalled();
		}
	});
});

describe('GET /api/v1/auth/oauth/thaid/callback (mode=member_scan)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetSessionsForTest();
	});

	function memberScanEvent(state: string) {
		return {
			url: new URL(`http://localhost/api/v1/auth/oauth/thaid/callback?code=c&state=${state}`),
			cookies: {
				get: vi.fn((name: string) => (name === 'oauth_thaid_state' ? state : undefined)),
				set: vi.fn(),
				delete: vi.fn()
			} as unknown as Cookies,
			fetch: vi.fn() as unknown as typeof fetch
		};
	}

	async function redirectOf(event: ReturnType<typeof memberScanEvent>) {
		try {
			await GET(event as Parameters<typeof GET>[0]);
		} catch (e) {
			return e as { status: number; location: string };
		}
		throw new Error('expected a redirect');
	}

	it('completes the member_scan session with the parsed profile and redirects to success', async () => {
		const session = createScanSession();
		mockParseThaidOAuthState.mockReturnValue({
			mode: 'member_scan',
			name: '',
			nonce: 'n',
			sessionId: session.id
		});
		mockExchangeThaidCode.mockResolvedValue(mockClaims);
		mockParseThaidCitizenClaims.mockReturnValue({ id: 'thaid-1100500123456', first_name: 'สมชาย' });

		const redir = await redirectOf(memberScanEvent('s-member'));

		expect(redir.status).toBe(302);
		expect(redir.location).toBe('/thaid-scan-success?status=success');
		expect(getScanSession(session.id)).toMatchObject({
			status: 'completed',
			profile: { first_name: 'สมชาย' }
		});
	});

	it('redirects to error=session_expired when the member_scan session is unknown', async () => {
		mockParseThaidOAuthState.mockReturnValue({
			mode: 'member_scan',
			name: '',
			nonce: 'n',
			sessionId: 'no-such-session'
		});
		mockExchangeThaidCode.mockResolvedValue(mockClaims);
		mockParseThaidCitizenClaims.mockReturnValue({ id: 'x', first_name: 'x' });

		const redir = await redirectOf(memberScanEvent('s-member'));

		expect(redir.location).toBe('/thaid-scan-success?error=session_expired');
	});

	it('does not let a member_scan state complete a kiosk_check_in session', async () => {
		const kioskSession = createKioskCheckInSession({ device_id: 'kiosk-1', shelter_code: 'SH001' });
		mockParseThaidOAuthState.mockReturnValue({
			mode: 'member_scan',
			name: '',
			nonce: 'n',
			sessionId: kioskSession.id
		});
		mockExchangeThaidCode.mockResolvedValue(mockClaims);
		mockParseThaidCitizenClaims.mockReturnValue({ id: 'x', first_name: 'x' });

		const redir = await redirectOf(memberScanEvent('s-member'));

		expect(redir.location).toBe('/thaid-scan-success?error=session_expired');
		expect(getKioskSessionForDevice(kioskSession.id, 'kiosk-1')?.status).toBe('pending');
	});
});

describe('GET /api/v1/auth/oauth/thaid/callback (mode=kiosk_check_in)', () => {
	const DEVICE = 'kiosk-1';

	beforeEach(() => {
		vi.clearAllMocks();
		_resetSessionsForTest();
	});

	function kioskEvent(query = 'code=c&state=s-kiosk', cookieState = 's-kiosk') {
		return {
			url: new URL(`http://localhost/api/v1/auth/oauth/thaid/callback?${query}`),
			cookies: {
				get: vi.fn((name: string) => (name === 'oauth_thaid_state' ? cookieState : undefined)),
				set: vi.fn(),
				delete: vi.fn()
			} as unknown as Cookies,
			fetch: vi.fn() as unknown as typeof fetch
		};
	}

	async function redirectOf(event: ReturnType<typeof kioskEvent>) {
		try {
			await GET(event as Parameters<typeof GET>[0]);
		} catch (e) {
			return e as { status: number; location: string };
		}
		throw new Error('expected a redirect');
	}

	function pendingKioskSession() {
		const session = createKioskCheckInSession({ device_id: DEVICE, shelter_code: 'SH001' });
		mockParseThaidOAuthState.mockReturnValue({
			mode: 'kiosk_check_in',
			name: '',
			nonce: 'n',
			sessionId: session.id
		});
		return session;
	}

	it('completes the kiosk session with pid + sub and redirects to the kiosk success page', async () => {
		const session = pendingKioskSession();
		mockExchangeThaidCode.mockResolvedValue(mockClaims);

		const redir = await redirectOf(kioskEvent());

		expect(redir.status).toBe(302);
		expect(redir.location).toBe('/thaid-scan-success?flow=kiosk&status=success');
		const stored = getKioskSessionForDevice(session.id, DEVICE);
		expect(stored?.status).toBe('completed');
		expect(stored?.citizen).toEqual({ pid: '1100500123456', sub: 'test-subject' });
	});

	it('redirects to error=missing_pid and leaves the session pending when ThaiD returns no pid', async () => {
		const session = pendingKioskSession();
		mockExchangeThaidCode.mockResolvedValue({ sub: 'test-subject', pid: null });

		const redir = await redirectOf(kioskEvent());

		expect(redir.location).toBe('/thaid-scan-success?flow=kiosk&error=missing_pid');
		expect(getKioskSessionForDevice(session.id, DEVICE)?.status).toBe('pending');
	});

	it.each(['12345', '11005001234567', 'abcdefghijklm'])(
		'redirects to error=missing_pid when pid %s is not exactly 13 digits',
		async (pid) => {
			const session = pendingKioskSession();
			mockExchangeThaidCode.mockResolvedValue({ sub: 'test-subject', pid });

			const redir = await redirectOf(kioskEvent());

			expect(redir.location).toBe('/thaid-scan-success?flow=kiosk&error=missing_pid');
			expect(getKioskSessionForDevice(session.id, DEVICE)?.status).toBe('pending');
		}
	);

	it('redirects to error=session_expired when the kiosk session was cancelled meanwhile', async () => {
		const session = pendingKioskSession();
		cancelKioskSession(session.id, DEVICE);
		mockExchangeThaidCode.mockResolvedValue(mockClaims);

		const redir = await redirectOf(kioskEvent());

		expect(redir.location).toBe('/thaid-scan-success?flow=kiosk&error=session_expired');
		expect(getKioskSessionForDevice(session.id, DEVICE)?.citizen).toBeUndefined();
	});

	it('redirects to error=oauth_exchange_failed when the DOPA exchange throws', async () => {
		const session = pendingKioskSession();
		mockExchangeThaidCode.mockRejectedValue(new ServiceError('INTERNAL', 'DOPA unreachable'));

		const redir = await redirectOf(kioskEvent());

		expect(redir.location).toBe('/thaid-scan-success?flow=kiosk&error=oauth_exchange_failed');
		expect(getKioskSessionForDevice(session.id, DEVICE)?.status).toBe('pending');
	});

	it('redirects to error=oauth_<idp error> when DOPA returns an error param', async () => {
		pendingKioskSession();

		const redir = await redirectOf(kioskEvent('error=access_denied&state=s-kiosk'));

		expect(redir.location).toBe('/thaid-scan-success?flow=kiosk&error=oauth_access_denied');
		expect(mockExchangeThaidCode).not.toHaveBeenCalled();
	});

	it('redirects to error=missing_session when the state carries no session id', async () => {
		mockParseThaidOAuthState.mockReturnValue({ mode: 'kiosk_check_in', name: '', nonce: 'n' });
		mockExchangeThaidCode.mockResolvedValue(mockClaims);

		const redir = await redirectOf(kioskEvent());

		expect(redir.location).toBe('/thaid-scan-success?flow=kiosk&error=missing_session');
	});

	it('redirects to the kiosk error page on a state mismatch', async () => {
		pendingKioskSession();

		const redir = await redirectOf(kioskEvent('code=c&state=s-kiosk', 'other-cookie-state'));

		expect(redir.location).toBe('/thaid-scan-success?flow=kiosk&error=invalid_state');
	});
});
