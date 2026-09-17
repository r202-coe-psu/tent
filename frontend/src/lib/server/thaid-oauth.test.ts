import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: {
		THAID_OAUTH_CLIENT_ID: 'test-thaid-client-id',
		THAID_OAUTH_CLIENT_SECRET: 'test-thaid-client-secret',
		EXTERNAL_API_SECRET: 'fallback-secret'
	}
}));

import {
	createThaidOAuthState,
	parseThaidOAuthState,
	maskPid,
	buildThaidAuthorizeUrl,
	resolveThaidLoginUser,
	exchangeThaidCode
} from './thaid-oauth';

describe('thaid-oauth helpers (CR-ThaID)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('OAuth state', () => {
		it('round-trips signed OAuth state for link, stepup, and login', () => {
			const link = createThaidOAuthState('link', '0812345678');
			expect(parseThaidOAuthState(link)).toMatchObject({ mode: 'link', name: '0812345678' });

			const stepup = createThaidOAuthState('stepup', '0812345678');
			expect(parseThaidOAuthState(stepup)).toMatchObject({ mode: 'stepup', name: '0812345678' });

			const login = createThaidOAuthState('login', '');
			const parsedLogin = parseThaidOAuthState(login);
			expect(parsedLogin).toMatchObject({ mode: 'login', name: '' });
			expect(typeof parsedLogin?.nonce).toBe('string');

			expect(parseThaidOAuthState('tampered.state')).toBeNull();
			expect(parseThaidOAuthState('')).toBeNull();
			expect(parseThaidOAuthState(undefined)).toBeNull();
		});
	});

	describe('maskPid', () => {
		it('masks 13-digit national ID correctly', () => {
			expect(maskPid('1234567890123')).toBe('1-xxxx-xxxxx-12-3');
			expect(maskPid('1-2345-67890-12-3')).toBe('1-xxxx-xxxxx-12-3');
		});

		it('returns null for invalid or missing PIDs', () => {
			expect(maskPid(null)).toBeNull();
			expect(maskPid(undefined)).toBeNull();
			expect(maskPid('12345')).toBeNull();
			expect(maskPid('123456789012345')).toBeNull();
			expect(maskPid('abcdefghijklm')).toBeNull();
		});
	});

	describe('buildThaidAuthorizeUrl', () => {
		it('constructs authorize URL with required scopes and parameters', () => {
			const url = buildThaidAuthorizeUrl({
				clientId: 'my-client',
				redirectUri: 'https://shelter.importstar.dev/callback',
				state: 'test-state-token'
			});

			const parsed = new URL(url);
			expect(parsed.searchParams.get('client_id')).toBe('my-client');
			expect(parsed.searchParams.get('redirect_uri')).toBe(
				'https://shelter.importstar.dev/callback'
			);
			expect(parsed.searchParams.get('response_type')).toBe('code');
			expect(parsed.searchParams.get('scope')).toBe('pid name openid');
			expect(parsed.searchParams.get('state')).toBe('test-state-token');
		});
	});

	describe('resolveThaidLoginUser', () => {
		it('resolves user with salt when enrolled', () => {
			expect(resolveThaidLoginUser({ name: '0812345678', salt: 'salt123' })).toEqual({
				ok: true,
				name: '0812345678',
				salt: 'salt123'
			});
		});

		it('rejects unlinked or missing salt users', () => {
			expect(resolveThaidLoginUser(null)).toEqual({
				ok: false,
				reason: 'thaid_not_linked'
			});
			expect(resolveThaidLoginUser({ name: '0812345678' })).toEqual({
				ok: false,
				reason: 'missing_salt'
			});
		});
	});

	describe('exchangeThaidCode', () => {
		it('exchanges code for claims and decodes id_token JWT', async () => {
			const mockPayload = {
				sub: 'thaid-sub-12345',
				name: 'นาย สมชาย ใจดี',
				pid: '1234567890123'
			};
			const mockJwt = `header.${Buffer.from(JSON.stringify(mockPayload)).toString('base64url')}.sig`;

			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					access_token: 'mock-access-token',
					id_token: mockJwt,
					scope: 'pid name openid'
				})
			});

			const claims = await exchangeThaidCode({
				code: 'auth-code-123',
				redirectUri: 'https://shelter.importstar.dev/callback',
				clientId: 'test-client',
				clientSecret: 'test-secret'
			});

			expect(claims.sub).toBe('thaid-sub-12345');
			expect(claims.name).toBe('นาย สมชาย ใจดี');
			expect(claims.pid).toBe('1234567890123');
			expect(claims.pid_masked).toBe('1-xxxx-xxxxx-12-3');
		});
	});
});
