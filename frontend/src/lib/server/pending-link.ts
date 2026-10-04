/**
 * `pending_link` — an OAuth identity that logged in but is not linked to any `_users` doc yet
 * (CR-141). Carried from the OAuth callback to `POST /api/v1/auth/link-account`.
 */

import { randomBytes } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { cookieSecure, signPayload, verifyPayload } from '$lib/server/signed-cookie';

export const PENDING_LINK_COOKIE = 'pending_link';
export const PENDING_LINK_TTL_SEC = 10 * 60;
const PREFIX = 'pending_link';

export type PendingLinkProvider = 'google' | 'thaid';

export interface PendingLink {
	provider: PendingLinkProvider;
	sub: string;
	email?: string | null;
	name?: string | null;
	pid_masked?: string | null;
	/** Per-OAuth-round id — rate-limit key for link attempts. */
	nonce: string;
}

export function setPendingLinkCookie(
	cookies: Cookies,
	link: Omit<PendingLink, 'nonce'>
): PendingLink {
	const value: PendingLink = { ...link, nonce: randomBytes(16).toString('base64url') };
	cookies.set(PENDING_LINK_COOKIE, signPayload(PREFIX, value, PENDING_LINK_TTL_SEC), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: cookieSecure(),
		maxAge: PENDING_LINK_TTL_SEC
	});
	return value;
}

export function readPendingLink(cookies: Cookies): PendingLink | null {
	const data = verifyPayload<PendingLink>(PREFIX, cookies.get(PENDING_LINK_COOKIE));
	if (!data) return null;
	if (data.provider !== 'google' && data.provider !== 'thaid') return null;
	if (typeof data.sub !== 'string' || !data.sub || typeof data.nonce !== 'string') return null;
	return {
		provider: data.provider,
		sub: data.sub,
		email: data.email ?? null,
		name: data.name ?? null,
		pid_masked: data.pid_masked ?? null,
		nonce: data.nonce
	};
}

export function clearPendingLinkCookie(cookies: Cookies): void {
	cookies.delete(PENDING_LINK_COOKIE, { path: '/' });
}

/** What the link page may show — never the raw `sub`. */
export function pendingLinkDisplay(link: PendingLink): string {
	if (link.provider === 'google') return link.email ?? 'Google';
	return link.name ?? link.pid_masked ?? 'ThaID';
}

/** Log-safe subject (first/last 4 chars). */
export function maskSubject(sub: string): string {
	if (sub.length <= 8) return '****';
	return `${sub.slice(0, 4)}…${sub.slice(-4)}`;
}
