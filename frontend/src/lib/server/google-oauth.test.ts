import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: {
		GOOGLE_OAUTH_CLIENT_ID: 'test-client-id',
		GOOGLE_OAUTH_CLIENT_SECRET: 'test-client-secret',
		EXTERNAL_API_SECRET: 'fallback-secret'
	}
}));

import {
	computeMfaFlags,
	signMfaOk,
	verifyMfaOkCookie,
	createOAuthState,
	parseOAuthState,
	mintAuthSessionCookie,
	mapCouchHashAlgorithm,
	resolveGoogleLoginUser
} from './google-oauth';

describe('google-oauth helpers (CR-124)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('signs and verifies mfa_ok for the expected username only', () => {
		const token = signMfaOk('alice');
		expect(verifyMfaOkCookie(token, 'alice')).toBe(true);
		expect(verifyMfaOkCookie(token, 'bob')).toBe(false);
		expect(verifyMfaOkCookie('tampered.token', 'alice')).toBe(false);
		expect(verifyMfaOkCookie(undefined, 'alice')).toBe(false);
	});

	it('computes pending_mfa only when enrolled and cookie invalid', () => {
		expect(computeMfaFlags({ enrolled: false, mfaOkValid: false })).toEqual({
			mfa_enrolled: false,
			pending_mfa: false
		});
		expect(computeMfaFlags({ enrolled: true, mfaOkValid: false })).toEqual({
			mfa_enrolled: true,
			pending_mfa: true
		});
		expect(computeMfaFlags({ enrolled: true, mfaOkValid: true })).toEqual({
			mfa_enrolled: true,
			pending_mfa: false
		});
	});

	it('round-trips signed OAuth state for link/stepup/login', () => {
		const stepup = createOAuthState('stepup', 'alice');
		expect(parseOAuthState(stepup)).toMatchObject({ mode: 'stepup', name: 'alice' });

		const login = createOAuthState('login', '');
		const parsedLogin = parseOAuthState(login);
		expect(parsedLogin).toMatchObject({ mode: 'login', name: '' });
		expect(typeof parsedLogin?.nonce).toBe('string');

		expect(parseOAuthState('not-valid')).toBeNull();
	});

	it('maps CouchDB hash tokens to Node crypto algorithms', () => {
		expect(mapCouchHashAlgorithm('sha')).toBe('sha1');
		expect(mapCouchHashAlgorithm('sha256')).toBe('sha256');
	});

	it('mints AuthSession matching CouchDB cookie format (fixed vector)', () => {
		// HMAC-SHA256(secret||salt, "alice:64f0a1b2") then base64url(user:timeHex:rawHmac)
		const value = mintAuthSessionCookie('alice', 'usersalt', 'couchsecret', 'sha256', 0x64f0a1b2);
		expect(value).toBe('YWxpY2U6NjRmMGExYjI6KDQW7In6KVWqRTf4b6nO6kpPaQYTjLh5Ci9Be_dQFw8');

		const sha1Value = mintAuthSessionCookie('alice', 'usersalt', 'couchsecret', 'sha', 0x64f0a1b2);
		expect(sha1Value).toBe('YWxpY2U6NjRmMGExYjI6PmlovyEOmjHCjwKrkj4VL9ZMHRw');
	});

	it('resolveGoogleLoginUser covers enrolled / not-linked / missing salt (login branches)', () => {
		expect(resolveGoogleLoginUser(null)).toEqual({ ok: false, reason: 'google_not_linked' });
		expect(resolveGoogleLoginUser({ name: 'alice' })).toEqual({
			ok: false,
			reason: 'missing_salt'
		});
		expect(resolveGoogleLoginUser({ name: 'alice', salt: 's1' })).toEqual({
			ok: true,
			name: 'alice',
			salt: 's1'
		});
	});
});
