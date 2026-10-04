/**
 * Server-only signed, self-expiring cookie payloads (CR-141 `pending_link`).
 *
 * Stateless on purpose: production runs several Node workers (`server/cluster.mjs`), so a
 * payload must verify on whichever worker receives the next request. Expiry is carried
 * inside the signed payload — cookie `maxAge` alone is client-controlled.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

function signingSecret(): string {
	return (
		env.EXTERNAL_API_SECRET || env.GOOGLE_OAUTH_CLIENT_SECRET || 'dev-insecure-mfa-signing-secret'
	);
}

export function cookieSecure(): boolean {
	return env.ORIGIN?.startsWith('https://') === true || process.env.NODE_ENV === 'production';
}

function hmac(prefix: string, payload: string): string {
	return createHmac('sha256', signingSecret()).update(`${prefix}:${payload}`).digest('base64url');
}

/** Sign `data` with an absolute expiry (`exp`, epoch seconds). */
export function signPayload<T extends object>(prefix: string, data: T, ttlSec: number): string {
	const exp = Math.floor(Date.now() / 1000) + ttlSec;
	const payload = Buffer.from(JSON.stringify({ ...data, exp }), 'utf8').toString('base64url');
	return `${payload}.${hmac(prefix, payload)}`;
}

/** Verify signature + expiry; `null` on any tamper, parse error or expiry. */
export function verifyPayload<T extends object>(
	prefix: string,
	token: string | undefined,
	nowSec: number = Math.floor(Date.now() / 1000)
): (T & { exp: number }) | null {
	if (!token) return null;
	const dot = token.lastIndexOf('.');
	if (dot <= 0) return null;
	const payload = token.slice(0, dot);
	const sig = Buffer.from(token.slice(dot + 1));
	const expected = Buffer.from(hmac(prefix, payload));
	if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
	try {
		const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T & {
			exp?: unknown;
		};
		if (typeof data.exp !== 'number' || data.exp <= nowSec) return null;
		return data as T & { exp: number };
	} catch {
		return null;
	}
}
