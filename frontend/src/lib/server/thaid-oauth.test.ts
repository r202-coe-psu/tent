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
	exchangeThaidCode,
	resolveThaidRedirectUri,
	parseThaidCitizenClaims,
	setCitizenClaimCookie,
	consumeCitizenClaimCookie,
	type ThaiDAutofillProfile
} from './thaid-oauth';
import { env } from '$env/dynamic/private';

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

	describe('resolveThaidRedirectUri', () => {
		const dummyUrl = new URL('https://shelter.example.com/some/page');

		it('returns configured redirect URI when THAID_OAUTH_REDIRECT_URI is set', () => {
			(env as Record<string, string | undefined>).THAID_OAUTH_REDIRECT_URI =
				'https://custom.example.com/callback';
			(env as Record<string, string | undefined>).THAID_OAUTH_CALLBACK_PATH = undefined;
			expect(resolveThaidRedirectUri(dummyUrl)).toBe('https://custom.example.com/callback');
		});

		it('uses THAID_OAUTH_CALLBACK_PATH when redirect URI is not explicitly set', () => {
			(env as Record<string, string | undefined>).THAID_OAUTH_REDIRECT_URI = undefined;
			(env as Record<string, string | undefined>).THAID_OAUTH_CALLBACK_PATH = '/custom/thaid/cb';
			expect(resolveThaidRedirectUri(dummyUrl)).toBe('https://shelter.example.com/custom/thaid/cb');
		});

		it('defaults to /api/v1/auth/oauth/thaid/callback when neither is set', () => {
			(env as Record<string, string | undefined>).THAID_OAUTH_REDIRECT_URI = undefined;
			(env as Record<string, string | undefined>).THAID_OAUTH_CALLBACK_PATH = undefined;
			expect(resolveThaidRedirectUri(dummyUrl)).toBe(
				'https://shelter.example.com/api/v1/auth/oauth/thaid/callback'
			);
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

	describe('register OAuth mode & citizen claims', () => {
		it('creates and parses register state with returnTo', () => {
			const state = createThaidOAuthState('register', undefined, '/pre-register?shelter=A');
			const parsed = parseThaidOAuthState(state);
			expect(parsed).toMatchObject({
				mode: 'register',
				returnTo: '/pre-register?shelter=A'
			});
			expect(parsed?.name).toBe('');
		});

		it('creates and parses member_scan state with sessionId', () => {
			const state = createThaidOAuthState('member_scan', undefined, undefined, 'sess_1234567890abcdef');
			const parsed = parseThaidOAuthState(state);
			expect(parsed).toMatchObject({
				mode: 'member_scan',
				sessionId: 'sess_1234567890abcdef'
			});
			expect(parsed?.name).toBe('');
		});

		it('parses ThaiD claims into ThaiDAutofillProfile with title prefix and address', () => {
			const claims = {
				sub: 'sub-user-99',
				pid: '1-1005-00123-45-6',
				name: 'นาย ประหยัด ร่ำรวย',
				raw: {
					given_name: 'นายประหยัด',
					family_name: 'ร่ำรวย',
					birthdate: '1985-04-12',
					gender: '1',
					phone: '0812345678',
					address: {
						house_no: '99/1',
						moo: 'หมู่ 4',
						tambon: 'ช้างเผือก',
						amphur: 'เมืองเชียงใหม่',
						changwat: 'เชียงใหม่',
						postcode: '50300'
					}
				}
			};

			const profile = parseThaidCitizenClaims(claims);
			expect(profile.person_id).toBe('1100500123456');
			expect(profile.first_name).toBe('ประหยัด');
			expect(profile.last_name).toBe('ร่ำรวย');
			expect(profile.gender).toBe('male');
			expect(profile.birth_year).toBe(2528); // 1985 + 543
			expect(profile.phone).toBe('0812345678');
			expect(profile.address).toEqual({
				address_no: '99/1',
				village_no: 'หมู่ 4',
				subdistrict: 'ช้างเผือก',
				district: 'เมืองเชียงใหม่',
				province: 'เชียงใหม่',
				postal_code: '50300'
			});
		});

		it('falls back to single name string and derives female gender from นางสาว prefix', () => {
			const claims = {
				sub: 'sub-user-88',
				pid: '3100500123456',
				name: 'นางสาว สมหญิง รักดี',
				raw: {
					birthdate: '2530-01-01'
				}
			};

			const profile = parseThaidCitizenClaims(claims);
			expect(profile.first_name).toBe('สมหญิง');
			expect(profile.last_name).toBe('รักดี');
			expect(profile.gender).toBe('female');
			expect(profile.birth_year).toBe(2530);
		});

		it('round-trips signed citizen claim cookie', () => {
			const mockProfile: ThaiDAutofillProfile = {
				id: 'thaid-1100500123456',
				roleLabel: 'ผู้ลงทะเบียนผ่าน ThaiD',
				person_id: '1100500123456',
				first_name: 'สมชาย',
				last_name: 'มั่นคง',
				nickname: '',
				gender: 'male',
				birth_year: 2528,
				age: 41,
				phone: '0812345678',
				vulnerable_groups: [],
				special_needs: [],
				medical_conditions: [],
				address: {
					address_no: '123/45',
					village_no: 'หมู่ 2',
					subdistrict: 'ช้างเผือก',
					district: 'เมืองเชียงใหม่',
					province: 'เชียงใหม่',
					postal_code: '50300'
				}
			};

			const cookieStore = new Map<string, string>();
			const mockCookies = {
				set: (name: string, value: string) => cookieStore.set(name, value),
				get: (name: string) => cookieStore.get(name),
				delete: (name: string) => cookieStore.delete(name)
			} as unknown as import('@sveltejs/kit').Cookies;

			setCitizenClaimCookie(mockCookies, mockProfile);
			expect(cookieStore.has('thaid_citizen_claim')).toBe(true);

			const consumed = consumeCitizenClaimCookie(mockCookies);
			expect(consumed).toEqual(mockProfile);
			expect(cookieStore.has('thaid_citizen_claim')).toBe(false);
		});
	});
});
