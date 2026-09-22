/**
 * Server-only ThaID OAuth helpers for staff MFA + linked login (BORA Digital ID).
 * Secrets never use PUBLIC_*; cookie `mfa_ok` is HMAC-bound to the username.
 * Mints CouchDB `AuthSession` from chttpd_auth secret + user salt for linked login.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import type { Cookies } from '@sveltejs/kit';
import { ServiceError } from '$lib/server/couch-admin';
// eslint-disable-next-line no-restricted-imports -- server-safe domain import; barrel pulls client UI / qrcode
import {
	type ThaiDAutofillProfile,
	stripThaiTitle,
	cleanAreaPrefix
} from '$lib/features/people/domain/thaid-profile';
import { lookupZipcode } from './thailand-location';

export type { ThaiDAutofillProfile };

export const OAUTH_THAID_STATE_COOKIE = 'oauth_thaid_state';

export type ThaidOAuthMode = 'link' | 'stepup' | 'login' | 'register' | 'member_scan';

export interface ThaidOAuthState {
	mode: ThaidOAuthMode;
	/** Username for link/stepup; empty string for login/register/member_scan until callback lookup. */
	name: string;
	nonce: string;
	/** Optional safe relative return path (e.g. /pre-register?shelter=SH001) for mode=register */
	returnTo?: string;
	/** Optional session ID for mode=member_scan cross-device flow */
	sessionId?: string;
}

export interface ThaidClaims {
	sub: string;
	name?: string | null;
	pid?: string | null;
	pid_masked?: string | null;
	raw?: Record<string, unknown>;
}

/** Pure outcome of enrolled-user lookup for mode=login. */
export type ThaidLoginLookup =
	| { ok: true; name: string; salt: string }
	| { ok: false; reason: 'thaid_not_linked' | 'missing_salt' };

function signingSecret(): string {
	return (
		env.THAID_OAUTH_CLIENT_SECRET ||
		env.GOOGLE_OAUTH_CLIENT_SECRET ||
		env.EXTERNAL_API_SECRET ||
		'dev-insecure-mfa-signing-secret'
	);
}

export function getThaidOAuthConfig(): {
	clientId: string;
	clientSecret: string;
	authUrl: string;
	tokenUrl: string;
	userinfoUrl: string;
} {
	const clientId = env.THAID_OAUTH_CLIENT_ID?.trim();
	const clientSecret = env.THAID_OAUTH_CLIENT_SECRET?.trim();
	if (!clientId || !clientSecret) {
		throw new ServiceError('VALIDATION', 'ThaID OAuth is not configured on the server');
	}
	const authUrl =
		env.THAID_OAUTH_AUTH_URL?.trim() || 'https://imauthsbx.bora.dopa.go.th/api/v2/oauth2/auth/';
	const tokenUrl =
		env.THAID_OAUTH_TOKEN_URL?.trim() || 'https://imauthsbx.bora.dopa.go.th/api/v2/oauth2/token/';
	const userinfoUrl =
		env.THAID_OAUTH_USERINFO_URL?.trim() ||
		tokenUrl.replace(/\/token\/?$/, '/userinfo/') ||
		'https://imauthsbx.bora.dopa.go.th/api/v2/oauth2/userinfo/';

	return { clientId, clientSecret, authUrl, tokenUrl, userinfoUrl };
}

export function resolveThaidRedirectUri(url: URL): string {
	const configured = env.THAID_OAUTH_REDIRECT_URI?.trim();
	if (configured) return configured;
	const callbackPath = env.THAID_OAUTH_CALLBACK_PATH?.trim() || '/api/v1/auth/oauth/thaid/callback';
	const normalizedPath = callbackPath.startsWith('/') ? callbackPath : `/${callbackPath}`;
	return `${url.origin}${normalizedPath}`;
}

function cookieSecure(): boolean {
	return env.ORIGIN?.startsWith('https://') === true || process.env.NODE_ENV === 'production';
}

function signStatePayload(payload: string): string {
	const sig = createHmac('sha256', signingSecret())
		.update(`oauth_thaid:${payload}`)
		.digest('base64url');
	return `${payload}.${sig}`;
}

function verifyStatePayload(value: string): string | null {
	const dot = value.lastIndexOf('.');
	if (dot <= 0) return null;
	const payload = value.slice(0, dot);
	const sig = value.slice(dot + 1);
	const expected = createHmac('sha256', signingSecret())
		.update(`oauth_thaid:${payload}`)
		.digest('base64url');
	try {
		const a = Buffer.from(sig);
		const b = Buffer.from(expected);
		if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
		return payload;
	} catch {
		return null;
	}
}

function isThaidOAuthMode(mode: unknown): mode is ThaidOAuthMode {
	return (
		mode === 'link' ||
		mode === 'stepup' ||
		mode === 'login' ||
		mode === 'register' ||
		mode === 'member_scan'
	);
}

export function createThaidOAuthState(
	mode: ThaidOAuthMode,
	name: string = '',
	returnTo?: string,
	sessionId?: string
): string {
	const state: ThaidOAuthState = {
		mode,
		name: name || '',
		nonce: randomBytes(16).toString('hex'),
		...(returnTo ? { returnTo } : {}),
		...(sessionId ? { sessionId } : {})
	};
	return signStatePayload(Buffer.from(JSON.stringify(state), 'utf8').toString('base64url'));
}

export function parseThaidOAuthState(raw: string | undefined): ThaidOAuthState | null {
	if (!raw) return null;
	const payload = verifyStatePayload(raw);
	if (!payload) return null;
	try {
		const parsed = JSON.parse(
			Buffer.from(payload, 'base64url').toString('utf8')
		) as ThaidOAuthState;
		if (
			!isThaidOAuthMode(parsed.mode) ||
			typeof parsed.name !== 'string' ||
			typeof parsed.nonce !== 'string' ||
			(parsed.returnTo !== undefined && typeof parsed.returnTo !== 'string') ||
			(parsed.sessionId !== undefined && typeof parsed.sessionId !== 'string')
		) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

export function setThaidOAuthStateCookie(cookies: Cookies, state: string): void {
	cookies.set(OAUTH_THAID_STATE_COOKIE, state, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: cookieSecure(),
		maxAge: 60 * 10
	});
}

export function clearThaidOAuthStateCookie(cookies: Cookies): void {
	cookies.delete(OAUTH_THAID_STATE_COOKIE, { path: '/' });
}

/**
 * Mask a 13-digit Thai national ID for display: `1-xxxx-xxxxx-12-3`
 * Never stores or exposes raw 13 digits unmasked on UI/profile.
 */
export function maskPid(rawPid: string | null | undefined): string | null {
	if (!rawPid) return null;
	const digits = rawPid.replace(/\D/g, '');
	if (digits.length !== 13) return null;
	return `${digits[0]}-xxxx-xxxxx-${digits.slice(10, 12)}-${digits[12]}`;
}

export function buildThaidAuthorizeUrl(opts: {
	clientId: string;
	redirectUri: string;
	state: string;
	authUrl?: string;
	mode?: ThaidOAuthMode;
}): string {
	const base = opts.authUrl || 'https://imauthsbx.bora.dopa.go.th/api/v2/oauth2/auth/';
	const defaultScope =
		opts.mode === 'register' || opts.mode === 'member_scan'
			? env.THAID_OAUTH_SCOPE?.trim() ||
				'openid pid name birthdate gender address house_address given_name family_name title'
			: 'pid name openid';
	const params = new URLSearchParams({
		response_type: 'code',
		client_id: opts.clientId,
		redirect_uri: opts.redirectUri,
		scope: defaultScope,
		state: opts.state
	});
	const separator = base.includes('?') ? '&' : '?';
	return `${base}${separator}${params.toString()}`;
}

export async function exchangeThaidCode(opts: {
	code: string;
	redirectUri: string;
	clientId: string;
	clientSecret: string;
	tokenUrl?: string;
	userinfoUrl?: string;
}): Promise<ThaidClaims> {
	const tokenUrl = opts.tokenUrl || 'https://imauthsbx.bora.dopa.go.th/api/v2/oauth2/token/';
	const userinfoUrl =
		opts.userinfoUrl ||
		env.THAID_OAUTH_USERINFO_URL?.trim() ||
		tokenUrl.replace(/\/token\/?$/, '/userinfo/') ||
		'https://imauthsbx.bora.dopa.go.th/api/v2/oauth2/userinfo/';
	const basicAuth = Buffer.from(`${opts.clientId}:${opts.clientSecret}`, 'utf8').toString('base64');

	const body = new URLSearchParams({
		grant_type: 'authorization_code',
		code: opts.code,
		redirect_uri: opts.redirectUri
	});

	const tokenRes = await fetch(tokenUrl, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Authorization: `Basic ${basicAuth}`,
			Accept: 'application/json'
		},
		body
	});

	const tokenData = (await tokenRes.json().catch(() => null)) as {
		access_token?: string;
		id_token?: string;
		sub?: string;
		pid?: string;
		name?: string;
		error?: string;
		error_description?: string;
		[key: string]: unknown;
	} | null;

	if (!tokenRes.ok || !tokenData) {
		throw new ServiceError(
			'VALIDATION',
			tokenData?.error_description || tokenData?.error || 'ThaID token exchange failed'
		);
	}

	let sub: string | null = null;
	let name: string | null = null;
	let pid: string | null = null;
	let idTokenClaims: Record<string, unknown> = {};

	if (tokenData.id_token) {
		idTokenClaims = decodeJwtPayload(tokenData.id_token);
		if (typeof idTokenClaims.sub === 'string' && idTokenClaims.sub) {
			sub = idTokenClaims.sub;
		}
		if (typeof idTokenClaims.name === 'string' && idTokenClaims.name) {
			name = idTokenClaims.name;
		}
		if (typeof idTokenClaims.pid === 'string' && idTokenClaims.pid) {
			pid = idTokenClaims.pid;
		}
	}

	// Fallback to top-level token response if id_token claims were not present
	if (!sub && typeof tokenData.sub === 'string' && tokenData.sub) {
		sub = tokenData.sub;
	}
	if (!name && typeof tokenData.name === 'string' && tokenData.name) {
		name = tokenData.name;
	}
	if (!pid && typeof tokenData.pid === 'string' && tokenData.pid) {
		pid = tokenData.pid;
	}

	// In OpenID Connect (and DOPA specifically), demographic & address claims
	// are returned from the UserInfo endpoint using the bearer access_token
	let userinfoClaims: Record<string, unknown> = {};
	if (tokenData.access_token) {
		try {
			const userinfoRes = await fetch(userinfoUrl, {
				method: 'GET',
				headers: {
					Authorization: `Bearer ${tokenData.access_token}`,
					Accept: 'application/json'
				}
			});
			if (userinfoRes.ok) {
				const json = (await userinfoRes.json().catch(() => null)) as Record<string, unknown> | null;
				if (json && typeof json === 'object') {
					userinfoClaims = json;
					if (!sub && typeof userinfoClaims.sub === 'string' && userinfoClaims.sub) {
						sub = userinfoClaims.sub;
					}
					if (!name && typeof userinfoClaims.name === 'string' && userinfoClaims.name) {
						name = userinfoClaims.name;
					}
					if (!pid && typeof userinfoClaims.pid === 'string' && userinfoClaims.pid) {
						pid = userinfoClaims.pid;
					}
				}
			} else {
				console.warn(
					`[thaid-oauth] UserInfo fetch returned HTTP ${userinfoRes.status} from ${userinfoUrl}`
				);
			}
		} catch (err) {
			console.warn('[thaid-oauth] Error calling ThaID UserInfo endpoint:', err);
		}
	}

	if (!sub) {
		throw new ServiceError('VALIDATION', 'ThaID did not return a valid subject identifier');
	}

	const raw: Record<string, unknown> = {
		...tokenData,
		...idTokenClaims,
		...userinfoClaims
	};

	return {
		sub,
		name: name ? name.trim() : null,
		pid: pid ? pid.trim() : null,
		pid_masked: maskPid(pid),
		raw
	};
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
	const parts = jwt.split('.');
	if (parts.length < 2) throw new ServiceError('VALIDATION', 'Invalid ThaID id_token');
	const json = Buffer.from(parts[1], 'base64url').toString('utf8');
	return JSON.parse(json) as Record<string, unknown>;
}

/** Decide whether a `_users` doc can mint a ThaID-login session. */
export function resolveThaidLoginUser(
	doc: { name: string; salt?: string } | null
): ThaidLoginLookup {
	if (!doc) return { ok: false, reason: 'thaid_not_linked' };
	const salt = typeof doc.salt === 'string' ? doc.salt : '';
	if (!salt) return { ok: false, reason: 'missing_salt' };
	return { ok: true, name: doc.name, salt };
}

export const THAID_CITIZEN_CLAIM_COOKIE = 'thaid_citizen_claim';

export function setCitizenClaimCookie(cookies: Cookies, profile: ThaiDAutofillProfile): void {
	const payload = Buffer.from(JSON.stringify(profile), 'utf8').toString('base64url');
	const signed = signStatePayload(payload);
	cookies.set(THAID_CITIZEN_CLAIM_COOKIE, signed, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: cookieSecure(),
		maxAge: 60 * 5 // 5 minutes
	});
}

export function consumeCitizenClaimCookie(cookies: Cookies): ThaiDAutofillProfile | null {
	const raw = cookies.get(THAID_CITIZEN_CLAIM_COOKIE);
	if (!raw) return null;
	cookies.delete(THAID_CITIZEN_CLAIM_COOKIE, { path: '/' });
	const payload = verifyStatePayload(raw);
	if (!payload) return null;
	try {
		const json = Buffer.from(payload, 'base64url').toString('utf8');
		return JSON.parse(json) as ThaiDAutofillProfile;
	} catch {
		return null;
	}
}

/**
 * Parse plain-text Thai formatted address string into components
 * e.g. "99/1 หมู่ 4 ตำบลช้างเผือก อำเภอเมืองเชียงใหม่ จังหวัดเชียงใหม่ 50300"
 */
export function parseThaiAddressText(text: string): {
	address_no?: string;
	village_no?: string;
	subdistrict?: string;
	district?: string;
	province?: string;
	postal_code?: string;
} {
	const trimmed = text.trim();
	if (!trimmed) return {};

	const result: {
		address_no?: string;
		village_no?: string;
		subdistrict?: string;
		district?: string;
		province?: string;
		postal_code?: string;
	} = {};

	// 1. Extract 5-digit postal code
	const zipMatch = trimmed.match(/(?:รหัสไปรษณีย์\s*)?(\b\d{5}\b)/);
	if (zipMatch) {
		result.postal_code = zipMatch[1];
	}

	// 2. Extract province (จังหวัด / จ.)
	const provMatch = trimmed.match(/(?:จังหวัด|จ\.)\s*([^\s,0-9]+)/);
	if (provMatch) {
		result.province = cleanAreaPrefix(provMatch[1]);
	}

	// 3. Extract district (อำเภอ / เขต / อ.)
	const distMatch = trimmed.match(/(?:อำเภอ|เขต|อ\.)\s*([^\s,0-9]+)/);
	if (distMatch) {
		result.district = cleanAreaPrefix(distMatch[1]);
	}

	// 4. Extract subdistrict (ตำบล / แขวง / ต.)
	const subMatch = trimmed.match(/(?:ตำบล|แขวง|ต\.)\s*([^\s,0-9]+)/);
	if (subMatch) {
		result.subdistrict = cleanAreaPrefix(subMatch[1]);
	}

	// 5. Extract village_no (หมู่ที่ / หมู่ / ม.)
	const mooMatch = trimmed.match(/(?:หมู่ที่|หมู่|ม\.)\s*([0-9]+)/);
	if (mooMatch) {
		result.village_no = mooMatch[1];
	}

	// 6. Extract house/street number: everything before village/subdistrict/district/province keywords
	const headMatch = trimmed.split(
		/(?:หมู่ที่|หมู่|ม\.|ตำบล|ต\.|แขวง|อำเภอ|อ\.|เขต|จังหวัด|จ\.)/
	)[0];
	if (headMatch) {
		const cleanedNo = headMatch.replace(/^(?:บ้านเลขที่|เลขที่)\s*/, '').trim();
		if (cleanedNo) {
			result.address_no = cleanedNo;
		}
	}

	return result;
}

export function parseThaidCitizenClaims(claims: ThaidClaims): ThaiDAutofillProfile {
	const raw = claims.raw ?? {};
	const pid = (claims.pid ?? (typeof raw.pid === 'string' ? raw.pid : '')).replace(/\D/g, '');

	let firstName: string;
	let lastName: string;
	let gender: 'male' | 'female' | 'other' = 'other';

	const givenName = typeof raw.given_name === 'string' ? raw.given_name.trim() : '';
	const familyName = typeof raw.family_name === 'string' ? raw.family_name.trim() : '';

	const rawGender =
		typeof raw.gender === 'string'
			? raw.gender.trim().toLowerCase()
			: typeof raw.gender === 'number'
				? String(raw.gender)
				: typeof raw.sex === 'string'
					? raw.sex.trim().toLowerCase()
					: typeof raw.sex === 'number'
						? String(raw.sex)
						: '';

	if (rawGender === 'male' || rawGender === '1' || rawGender === 'm' || rawGender === 'ชาย') {
		gender = 'male';
	} else if (
		rawGender === 'female' ||
		rawGender === '2' ||
		rawGender === 'f' ||
		rawGender === 'หญิง'
	) {
		gender = 'female';
	}

	// If gender is still 'other', check title claim
	if (gender === 'other' && typeof raw.title === 'string' && raw.title) {
		const titleInferred = stripThaiTitle(raw.title).inferredGender;
		if (titleInferred) {
			gender = titleInferred;
		}
	}

	if (givenName) {
		const stripped = stripThaiTitle(givenName);
		firstName = stripped.cleanedText;
		if (gender === 'other' && stripped.inferredGender) {
			gender = stripped.inferredGender;
		}
		lastName = familyName;
	} else {
		const rawFullName = (claims.name || (typeof raw.name === 'string' ? raw.name : '')).trim();
		const stripped = stripThaiTitle(rawFullName);
		if (gender === 'other' && stripped.inferredGender) {
			gender = stripped.inferredGender;
		}
		const parts = stripped.cleanedText.split(/\s+/).filter(Boolean);
		firstName = parts[0] ?? '';
		lastName = parts.slice(1).join(' ') ?? '';
	}

	// Birthdate / age parsing — do not assume hardcoded age 30 when omitted
	const currentCeYear = new Date().getFullYear();
	const currentBeYear = currentCeYear + 543;
	let birthYear = 0;
	let age = 0;

	const rawBirth =
		typeof raw.birthdate === 'string'
			? raw.birthdate
			: typeof raw.birth_date === 'string'
				? raw.birth_date
				: typeof raw.bdate === 'string'
					? raw.bdate
					: null;

	if (rawBirth) {
		const match = rawBirth.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})/);
		if (match) {
			let parsedYear = parseInt(match[1], 10);
			if (parsedYear < 2400) {
				parsedYear += 543; // convert CE to BE
			}
			birthYear = parsedYear;
			age = Math.max(0, currentBeYear - birthYear);
		}
	}

	// Address mapping: support house_address, address (OIDC standard / DOPA), and formatted strings
	const address = {
		address_no: '',
		village_no: '',
		subdistrict: '',
		district: '',
		province: '',
		postal_code: ''
	};

	const parseIfJson = (val: unknown): unknown => {
		if (typeof val === 'string' && val.trim().startsWith('{')) {
			try {
				return JSON.parse(val.trim());
			} catch {
				return val;
			}
		}
		return val;
	};

	const houseAddressVal = parseIfJson(raw.house_address);
	const addressVal = parseIfJson(raw.address);

	// 1. Check for #-delimited raw format (DOPA scope 19 / scope 5: เลขที่#หมู่ที่#ตรอก#ซอย#ถนน#ตำบล#อำเภอ#จังหวัด)
	const hashDelimited =
		typeof houseAddressVal === 'string' && houseAddressVal.includes('#')
			? houseAddressVal
			: houseAddressVal &&
				  typeof houseAddressVal === 'object' &&
				  typeof (houseAddressVal as Record<string, unknown>).raw === 'string' &&
				  ((houseAddressVal as Record<string, unknown>).raw as string).includes('#')
				? ((houseAddressVal as Record<string, unknown>).raw as string)
				: typeof addressVal === 'string' && addressVal.includes('#')
					? addressVal
					: addressVal &&
						  typeof addressVal === 'object' &&
						  typeof (addressVal as Record<string, unknown>).raw === 'string' &&
						  ((addressVal as Record<string, unknown>).raw as string).includes('#')
						? ((addressVal as Record<string, unknown>).raw as string)
						: null;

	if (hashDelimited) {
		const parts = hashDelimited.split('#').map((p) => p.trim());
		address.address_no = parts[0] ?? '';
		address.village_no = parts[1] ?? '';
		// parts[2]=ตรอก, parts[3]=ซอย, parts[4]=ถนน
		address.subdistrict = cleanAreaPrefix(parts[5] ?? '');
		address.district = cleanAreaPrefix(parts[6] ?? '');
		address.province = cleanAreaPrefix(parts[7] ?? '');
	}

	// 2. Check address objects (DOPA Thai schema & OIDC standard address schema)
	const applyAddressObject = (obj: Record<string, unknown>) => {
		if (!address.address_no) {
			const no =
				typeof obj.house_no === 'string'
					? obj.house_no
					: typeof obj.address_no === 'string'
						? obj.address_no
						: typeof obj.street_address === 'string'
							? obj.street_address
							: typeof obj.houseNo === 'string'
								? obj.houseNo
								: '';
			if (no) address.address_no = no.trim();
		}
		if (!address.village_no) {
			const v =
				typeof obj.village_no === 'string'
					? obj.village_no
					: typeof obj.moo === 'string'
						? obj.moo
						: typeof obj.villageNo === 'string'
							? obj.villageNo
							: typeof obj.moo_no === 'string'
								? obj.moo_no
								: '';
			if (v) address.village_no = v.trim();
		}
		if (!address.subdistrict) {
			const sub =
				typeof obj.subdistrict === 'string'
					? obj.subdistrict
					: typeof obj.tambon === 'string'
						? obj.tambon
						: typeof obj.subDistrict === 'string'
							? obj.subDistrict
							: typeof obj.locality === 'string'
								? obj.locality
								: '';
			if (sub) address.subdistrict = cleanAreaPrefix(sub);
		}
		if (!address.district) {
			const dist =
				typeof obj.district === 'string'
					? obj.district
					: typeof obj.amphur === 'string'
						? obj.amphur
						: typeof obj.amphoe === 'string'
							? obj.amphoe
							: typeof obj.districtName === 'string'
								? obj.districtName
								: '';
			if (dist) address.district = cleanAreaPrefix(dist);
		}
		if (!address.province) {
			const prov =
				typeof obj.province === 'string'
					? obj.province
					: typeof obj.changwat === 'string'
						? obj.changwat
						: typeof obj.region === 'string'
							? obj.region
							: typeof obj.provinceName === 'string'
								? obj.provinceName
								: '';
			if (prov) address.province = cleanAreaPrefix(prov);
		}
		if (!address.postal_code) {
			const zip =
				typeof obj.postal_code === 'string'
					? obj.postal_code
					: typeof obj.postcode === 'string'
						? obj.postcode
						: typeof obj.zipcode === 'string'
							? obj.zipcode
							: typeof obj.postalCode === 'string'
								? obj.postalCode
								: typeof obj.zip_code === 'string'
									? obj.zip_code
									: '';
			if (zip) address.postal_code = zip.trim();
		}
	};

	if (houseAddressVal && typeof houseAddressVal === 'object') {
		applyAddressObject(houseAddressVal as Record<string, unknown>);
	}
	if (addressVal && typeof addressVal === 'object') {
		applyAddressObject(addressVal as Record<string, unknown>);
	}

	// 3. If fields are still missing or address_no is empty, parse formatted string
	const formattedCandidate =
		typeof raw.formatted_address === 'string' && raw.formatted_address
			? raw.formatted_address
			: typeof addressVal === 'string' && !addressVal.includes('#')
				? addressVal
				: typeof houseAddressVal === 'string' && !houseAddressVal.includes('#')
					? houseAddressVal
					: houseAddressVal &&
						  typeof houseAddressVal === 'object' &&
						  typeof (houseAddressVal as Record<string, unknown>).formatted === 'string'
						? ((houseAddressVal as Record<string, unknown>).formatted as string)
						: addressVal &&
							  typeof addressVal === 'object' &&
							  typeof (addressVal as Record<string, unknown>).formatted === 'string'
							? ((addressVal as Record<string, unknown>).formatted as string)
							: null;

	if (formattedCandidate) {
		const parsed = parseThaiAddressText(formattedCandidate);
		if (!address.address_no && parsed.address_no) address.address_no = parsed.address_no;
		if (!address.village_no && parsed.village_no) address.village_no = parsed.village_no;
		if (!address.subdistrict && parsed.subdistrict) address.subdistrict = parsed.subdistrict;
		if (!address.district && parsed.district) address.district = parsed.district;
		if (!address.province && parsed.province) address.province = parsed.province;
		if (!address.postal_code && parsed.postal_code) address.postal_code = parsed.postal_code;
		// If address_no is still blank, assign the raw string as fallback
		if (!address.address_no) address.address_no = formattedCandidate.trim();
	}

	// 4. Resolve postal code automatically if missing but province and subdistrict are known
	if (!address.postal_code && address.province && address.subdistrict) {
		address.postal_code =
			lookupZipcode(address.province, address.district, address.subdistrict) ?? '';
	}

	const rawPhone =
		typeof raw.phone_number === 'string'
			? raw.phone_number
			: typeof raw.phone === 'string'
				? raw.phone
				: null;
	const phone = rawPhone ? rawPhone.replace(/[-\s]/g, '').trim() || null : null;

	return {
		id: `thaid-${pid || claims.sub}`,
		roleLabel: 'ผู้ลงทะเบียนผ่าน ThaiD',
		person_id: pid,
		first_name: firstName,
		last_name: lastName,
		nickname: '',
		gender,
		birth_year: birthYear,
		age,
		phone,
		vulnerable_groups: [],
		special_needs: [],
		medical_conditions: [],
		address
	};
}
