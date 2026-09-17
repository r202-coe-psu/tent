/**
 * Server-only ThaID OAuth helpers for staff MFA + linked login (BORA Digital ID).
 * Secrets never use PUBLIC_*; cookie `mfa_ok` is HMAC-bound to the username.
 * Mints CouchDB `AuthSession` from chttpd_auth secret + user salt for linked login.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import type { Cookies } from '@sveltejs/kit';
import { ServiceError } from '$lib/server/couch-admin';

export const OAUTH_THAID_STATE_COOKIE = 'oauth_thaid_state';

export type ThaidOAuthMode = 'link' | 'stepup' | 'login';

export interface ThaidOAuthState {
	mode: ThaidOAuthMode;
	/** Username for link/stepup; empty string for login until callback lookup. */
	name: string;
	nonce: string;
}

export interface ThaidClaims {
	sub: string;
	name?: string | null;
	pid?: string | null;
	pid_masked?: string | null;
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

	return { clientId, clientSecret, authUrl, tokenUrl };
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
	return mode === 'link' || mode === 'stepup' || mode === 'login';
}

export function createThaidOAuthState(mode: ThaidOAuthMode, name: string): string {
	const state: ThaidOAuthState = {
		mode,
		name,
		nonce: randomBytes(16).toString('hex')
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
			typeof parsed.nonce !== 'string'
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
}): string {
	const base = opts.authUrl || 'https://imauthsbx.bora.dopa.go.th/api/v2/oauth2/auth/';
	const params = new URLSearchParams({
		response_type: 'code',
		client_id: opts.clientId,
		redirect_uri: opts.redirectUri,
		scope: 'pid name openid',
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
}): Promise<ThaidClaims> {
	const tokenUrl = opts.tokenUrl || 'https://imauthsbx.bora.dopa.go.th/api/v2/oauth2/token/';
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

	if (tokenData.id_token) {
		const claims = decodeJwtPayload(tokenData.id_token);
		if (typeof claims.sub === 'string' && claims.sub) {
			sub = claims.sub;
		}
		if (typeof claims.name === 'string' && claims.name) {
			name = claims.name;
		}
		if (typeof claims.pid === 'string' && claims.pid) {
			pid = claims.pid;
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

	if (!sub) {
		throw new ServiceError('VALIDATION', 'ThaID did not return a valid subject identifier');
	}

	return {
		sub,
		name: name ? name.trim() : null,
		pid: pid ? pid.trim() : null,
		pid_masked: maskPid(pid)
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
