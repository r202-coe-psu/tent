/**
 * Server-only Google OAuth helpers for staff MFA + SSO login (CR-124).
 * Secrets never use PUBLIC_*; cookie `mfa_ok` is HMAC-bound to the username.
 * Phase 2 mints CouchDB `AuthSession` from chttpd_auth secret + user salt.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import type { Cookies } from '@sveltejs/kit';
import { adminRaw, ServiceError } from '$lib/server/couch-admin';

export const MFA_OK_COOKIE = 'mfa_ok';
export const OAUTH_STATE_COOKIE = 'oauth_google_state';
export const AUTH_SESSION_COOKIE = 'AuthSession';

/** Align with couchdb-session.ini `timeout = 86400` when readable; else 24h. */
export const AUTH_SESSION_MAX_AGE_SEC = 86_400;

export type GoogleOAuthMode = 'link' | 'stepup' | 'login';

export interface GoogleOAuthState {
	mode: GoogleOAuthMode;
	/** Username for link/stepup; empty string for login until callback lookup. */
	name: string;
	nonce: string;
}

export interface GoogleIdClaims {
	sub: string;
	email?: string | null;
}

/** Pure outcome of enrolled-user lookup for mode=login (AC-15). */
export type GoogleLoginLookup =
	| { ok: true; name: string; salt: string }
	| { ok: false; reason: 'google_not_linked' | 'missing_salt' };

function signingSecret(): string {
	return (
		env.GOOGLE_OAUTH_CLIENT_SECRET || env.EXTERNAL_API_SECRET || 'dev-insecure-mfa-signing-secret'
	);
}

export function getGoogleOAuthConfig(): { clientId: string; clientSecret: string } {
	const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
	const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
	if (!clientId || !clientSecret) {
		throw new ServiceError('VALIDATION', 'Google OAuth is not configured on the server');
	}
	return { clientId, clientSecret };
}

export function resolveGoogleRedirectUri(url: URL): string {
	const configured = env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
	if (configured) return configured;
	return `${url.origin}/api/v1/auth/oauth/google/callback`;
}

export function signMfaOk(name: string): string {
	const sig = createHmac('sha256', signingSecret()).update(`mfa:${name}`).digest('base64url');
	return `${name}.${sig}`;
}

export function verifyMfaOkCookie(value: string | undefined, expectedName: string): boolean {
	if (!value) return false;
	const dot = value.indexOf('.');
	if (dot <= 0) return false;
	const name = value.slice(0, dot);
	const sig = value.slice(dot + 1);
	if (!sig || name !== expectedName) return false;
	const expected = createHmac('sha256', signingSecret()).update(`mfa:${name}`).digest('base64url');
	try {
		const a = Buffer.from(sig);
		const b = Buffer.from(expected);
		return a.length === b.length && timingSafeEqual(a, b);
	} catch {
		return false;
	}
}

/** Pure helper — enrolled && !valid cookie ⇒ pending_mfa. */
export function computeMfaFlags(opts: { enrolled: boolean; mfaOkValid: boolean }): {
	mfa_enrolled: boolean;
	pending_mfa: boolean;
} {
	return {
		mfa_enrolled: opts.enrolled,
		pending_mfa: opts.enrolled && !opts.mfaOkValid
	};
}

function cookieSecure(): boolean {
	return env.ORIGIN?.startsWith('https://') === true || process.env.NODE_ENV === 'production';
}

export function setMfaOkCookie(cookies: Cookies, name: string): void {
	cookies.set(MFA_OK_COOKIE, signMfaOk(name), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: cookieSecure(),
		maxAge: 60 * 60 * 12
	});
}

export function clearMfaOkCookie(cookies: Cookies): void {
	cookies.delete(MFA_OK_COOKIE, { path: '/' });
}

function signStatePayload(payload: string): string {
	const sig = createHmac('sha256', signingSecret()).update(`oauth:${payload}`).digest('base64url');
	return `${payload}.${sig}`;
}

function verifyStatePayload(value: string): string | null {
	const dot = value.lastIndexOf('.');
	if (dot <= 0) return null;
	const payload = value.slice(0, dot);
	const sig = value.slice(dot + 1);
	const expected = createHmac('sha256', signingSecret())
		.update(`oauth:${payload}`)
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

function isGoogleOAuthMode(mode: unknown): mode is GoogleOAuthMode {
	return mode === 'link' || mode === 'stepup' || mode === 'login';
}

export function createOAuthState(mode: GoogleOAuthMode, name: string): string {
	const state: GoogleOAuthState = {
		mode,
		name,
		nonce: randomBytes(16).toString('hex')
	};
	return signStatePayload(Buffer.from(JSON.stringify(state), 'utf8').toString('base64url'));
}

export function parseOAuthState(raw: string | undefined): GoogleOAuthState | null {
	if (!raw) return null;
	const payload = verifyStatePayload(raw);
	if (!payload) return null;
	try {
		const parsed = JSON.parse(
			Buffer.from(payload, 'base64url').toString('utf8')
		) as GoogleOAuthState;
		if (
			!isGoogleOAuthMode(parsed.mode) ||
			typeof parsed.name !== 'string' ||
			typeof parsed.nonce !== 'string'
		) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

export function setOAuthStateCookie(cookies: Cookies, state: string): void {
	cookies.set(OAUTH_STATE_COOKIE, state, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: cookieSecure(),
		maxAge: 60 * 10
	});
}

export function clearOAuthStateCookie(cookies: Cookies): void {
	cookies.delete(OAUTH_STATE_COOKIE, { path: '/' });
}

/**
 * Map CouchDB `hash_algorithms` token to Node crypto HMAC algorithm.
 * CouchDB uses `sha` for SHA-1; Node uses `sha1`.
 */
export function mapCouchHashAlgorithm(token: string): string {
	const t = token.trim().toLowerCase();
	if (t === 'sha' || t === 'sha1') return 'sha1';
	if (t === 'sha224' || t === 'sha256' || t === 'sha384' || t === 'sha512') return t;
	throw new ServiceError('VALIDATION', `Unsupported CouchDB hash algorithm: ${token}`);
}

/**
 * Mint a CouchDB Cookie Authentication value (no `AuthSession=` prefix).
 * Format: base64url(user:timeHex:HMAC(secret||salt, user:timeHex)) with raw HMAC bytes.
 */
export function mintAuthSessionCookie(
	name: string,
	salt: string,
	secret: string,
	algo: string,
	timestampSec?: number
): string {
	const ts = timestampSec ?? Math.floor(Date.now() / 1000);
	const timeHex = ts.toString(16);
	const sessionData = `${name}:${timeHex}`;
	const key = Buffer.concat([Buffer.from(secret, 'utf8'), Buffer.from(salt, 'utf8')]);
	const hmac = createHmac(mapCouchHashAlgorithm(algo), key).update(sessionData, 'utf8').digest();
	return Buffer.concat([Buffer.from(`${sessionData}:`, 'utf8'), hmac]).toString('base64url');
}

export function setAuthSessionCookie(cookies: Cookies, value: string): void {
	cookies.set(AUTH_SESSION_COOKIE, value, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: cookieSecure(),
		maxAge: AUTH_SESSION_MAX_AGE_SEC
	});
}

/** Decide whether a `_users` doc can mint a Google-login session (Option C). */
export function resolveGoogleLoginUser(
	doc: { name: string; salt?: string } | null
): GoogleLoginLookup {
	if (!doc) return { ok: false, reason: 'google_not_linked' };
	const salt = typeof doc.salt === 'string' ? doc.salt : '';
	if (!salt) return { ok: false, reason: 'missing_salt' };
	return { ok: true, name: doc.name, salt };
}

function configValueAsString(data: unknown): string | null {
	if (typeof data === 'string' && data.length > 0) return data;
	if (typeof data === 'number') return String(data);
	return null;
}

async function readCouchConfig(section: string, key: string): Promise<string | null> {
	const res = await adminRaw(`/_node/_local/_config/${section}/${key}`, 'GET');
	if (res.status !== 200) return null;
	return configValueAsString(res.data);
}

/** Read cookie-auth secret (chttpd_auth first, then legacy couch_httpd_auth). */
export async function fetchCouchAuthSecret(): Promise<string> {
	const secret =
		(await readCouchConfig('chttpd_auth', 'secret')) ||
		(await readCouchConfig('couch_httpd_auth', 'secret'));
	if (!secret) {
		throw new ServiceError('VALIDATION', 'CouchDB cookie auth secret is not configured');
	}
	return secret;
}

/**
 * First algorithm from `hash_algorithms` (used when minting new cookies).
 * Defaults to sha256 when unset (CouchDB 3.4+ style). Returns CouchDB token (`sha` / `sha256`).
 */
export async function fetchCouchAuthHashAlgorithm(): Promise<string> {
	const raw =
		(await readCouchConfig('chttpd_auth', 'hash_algorithms')) ||
		(await readCouchConfig('couch_httpd_auth', 'hash_algorithms'));
	if (!raw) return 'sha256';
	const first = raw.split(',')[0]?.trim();
	if (!first) return 'sha256';
	// Validate supported token; keep CouchDB spelling (`sha` not `sha1`) for callers.
	mapCouchHashAlgorithm(first);
	return first;
}

export function buildGoogleAuthorizeUrl(opts: {
	clientId: string;
	redirectUri: string;
	state: string;
}): string {
	const params = new URLSearchParams({
		client_id: opts.clientId,
		redirect_uri: opts.redirectUri,
		response_type: 'code',
		scope: 'openid email',
		state: opts.state,
		prompt: 'select_account'
	});
	return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode(opts: {
	code: string;
	redirectUri: string;
	clientId: string;
	clientSecret: string;
}): Promise<GoogleIdClaims> {
	const body = new URLSearchParams({
		code: opts.code,
		client_id: opts.clientId,
		client_secret: opts.clientSecret,
		redirect_uri: opts.redirectUri,
		grant_type: 'authorization_code'
	});

	const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
		body
	});
	const tokenData = (await tokenRes.json().catch(() => null)) as {
		id_token?: string;
		access_token?: string;
		error?: string;
		error_description?: string;
	} | null;

	if (!tokenRes.ok || !tokenData) {
		throw new ServiceError(
			'VALIDATION',
			tokenData?.error_description || tokenData?.error || 'Google token exchange failed'
		);
	}

	if (tokenData.id_token) {
		const claims = decodeJwtPayload(tokenData.id_token);
		if (typeof claims.sub === 'string' && claims.sub) {
			return {
				sub: claims.sub,
				email: typeof claims.email === 'string' ? claims.email : null
			};
		}
	}

	if (!tokenData.access_token) {
		throw new ServiceError('VALIDATION', 'Google did not return id_token or access_token');
	}

	const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
		headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/json' }
	});
	const info = (await infoRes.json().catch(() => null)) as {
		sub?: string;
		email?: string;
	} | null;
	if (!infoRes.ok || !info?.sub) {
		throw new ServiceError('VALIDATION', 'Failed to fetch Google userinfo');
	}
	return { sub: info.sub, email: info.email ?? null };
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
	const parts = jwt.split('.');
	if (parts.length < 2) throw new ServiceError('VALIDATION', 'Invalid Google id_token');
	const json = Buffer.from(parts[1], 'base64url').toString('utf8');
	return JSON.parse(json) as Record<string, unknown>;
}
