import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { GET } from './+server';
import {
	_resetSessionsForTest,
	cancelKioskSession,
	createKioskCheckInSession,
	createScanSession
} from '$lib/server/thaid-scan-session';
import { parseThaidOAuthState } from '$lib/server/thaid-oauth';

const { mockIsThaidRegistrationEnabled, mockIsKioskThaidCheckInAllowed } = vi.hoisted(() => ({
	mockIsThaidRegistrationEnabled: vi.fn(),
	mockIsKioskThaidCheckInAllowed: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({
	env: {
		THAID_OAUTH_CLIENT_ID: 'test-client',
		THAID_OAUTH_CLIENT_SECRET: 'test-secret',
		THAID_OAUTH_AUTH_URL: 'https://dopa.example/oauth2/auth/',
		EXTERNAL_API_SECRET: 'fallback-secret'
	}
}));

vi.mock('$lib/server/thaid-registration-gate', () => ({
	isThaidRegistrationEnabled: mockIsThaidRegistrationEnabled
}));

vi.mock('$lib/features/kiosk/server', () => ({
	isKioskThaidCheckInAllowed: mockIsKioskThaidCheckInAllowed
}));

vi.mock('$lib/db/couch', () => ({ getSession: vi.fn() }));

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn(),
	ServiceError: class MockServiceError extends Error {
		code: string;
		constructor(code: string, message: string) {
			super(message);
			this.code = code;
		}
	},
	serviceError: vi.fn(() => new Response(null, { status: 500 }))
}));

const BINDING = { device_id: 'kiosk-1', shelter_code: 'SH001' };

function createEvent(query: string) {
	const cookies = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
	return {
		event: {
			url: new URL(`http://localhost/api/v1/auth/oauth/thaid/start?${query}`),
			cookies: cookies as unknown as Cookies,
			fetch: vi.fn() as unknown as typeof fetch
		},
		cookies
	};
}

async function redirectOf(query: string) {
	const { event, cookies } = createEvent(query);
	try {
		await GET(event as Parameters<typeof GET>[0]);
	} catch (e) {
		return { redir: e as { status: number; location: string }, cookies };
	}
	throw new Error('expected a redirect');
}

describe('GET /api/v1/auth/oauth/thaid/start (mode=kiosk_check_in)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetSessionsForTest();
		mockIsThaidRegistrationEnabled.mockResolvedValue({ enabled: true, isDev: false, mode: 'real' });
		mockIsKioskThaidCheckInAllowed.mockResolvedValue(true);
	});

	it('redirects to error=missing_session when session_id is absent', async () => {
		const { redir } = await redirectOf('mode=kiosk_check_in');

		expect(redir.status).toBe(302);
		expect(redir.location).toBe('/thaid-scan-success?flow=kiosk&error=missing_session');
	});

	it('redirects to error=thaid_disabled when the system ThaiD kill-switch is off', async () => {
		const session = createKioskCheckInSession(BINDING);
		mockIsThaidRegistrationEnabled.mockResolvedValue({
			enabled: false,
			isDev: false,
			mode: 'real'
		});

		const { redir } = await redirectOf(`mode=kiosk_check_in&session_id=${session.id}`);

		expect(redir.status).toBe(302);
		expect(redir.location).toBe('/thaid-scan-success?flow=kiosk&error=thaid_disabled');
	});

	it('redirects to error=session_expired when the session id is unknown', async () => {
		const { redir } = await redirectOf('mode=kiosk_check_in&session_id=no-such-session');

		expect(redir.status).toBe(302);
		expect(redir.location).toBe('/thaid-scan-success?flow=kiosk&error=session_expired');
	});

	it('redirects to error=session_expired when the session was cancelled', async () => {
		const session = createKioskCheckInSession(BINDING);
		cancelKioskSession(session.id, BINDING.device_id);

		const { redir } = await redirectOf(`mode=kiosk_check_in&session_id=${session.id}`);

		expect(redir.location).toBe('/thaid-scan-success?flow=kiosk&error=session_expired');
	});

	it('redirects to error=session_expired for a member_scan session (wrong kind)', async () => {
		const session = createScanSession();

		const { redir } = await redirectOf(`mode=kiosk_check_in&session_id=${session.id}`);

		expect(redir.location).toBe('/thaid-scan-success?flow=kiosk&error=session_expired');
	});

	it('redirects to error=thaid_disabled when the shelter gate is closed, asking for the bound shelter', async () => {
		const session = createKioskCheckInSession(BINDING);
		mockIsKioskThaidCheckInAllowed.mockResolvedValue(false);

		const { redir } = await redirectOf(`mode=kiosk_check_in&session_id=${session.id}`);

		expect(redir.location).toBe('/thaid-scan-success?flow=kiosk&error=thaid_disabled');
		expect(mockIsKioskThaidCheckInAllowed).toHaveBeenCalledWith('SH001');
	});

	it('redirects to DOPA with scope "openid pid" and sets a signed state cookie carrying the session', async () => {
		const session = createKioskCheckInSession(BINDING);

		const { redir, cookies } = await redirectOf(`mode=kiosk_check_in&session_id=${session.id}`);

		expect(redir.status).toBe(302);
		const target = new URL(redir.location);
		expect(`${target.origin}${target.pathname}`).toBe('https://dopa.example/oauth2/auth/');
		expect(target.searchParams.get('scope')).toBe('openid pid');
		expect(target.searchParams.get('client_id')).toBe('test-client');
		expect(target.searchParams.get('redirect_uri')).toBe(
			'http://localhost/api/v1/auth/oauth/thaid/callback'
		);

		expect(cookies.set).toHaveBeenCalledWith(
			'oauth_thaid_state',
			target.searchParams.get('state'),
			expect.objectContaining({ httpOnly: true })
		);
		expect(parseThaidOAuthState(target.searchParams.get('state') ?? undefined)).toMatchObject({
			mode: 'kiosk_check_in',
			sessionId: session.id
		});
	});
});
