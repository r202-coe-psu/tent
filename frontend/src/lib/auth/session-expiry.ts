/**
 * Pure session-expiry policy (CONTRIBUTING.md §4 — "Session expiry").
 *
 *  - A 401 from the active CouchDB endpoint means the session expired.
 *  - A 403, or a 401 from a BFF `/api/*` route, is only *possibly* expiry; the caller
 *    must confirm with `GET /_session` before opening the login modal.
 *  - Network errors are offline (ConnectionBanner), never expiry.
 *
 * No I/O, no Svelte — unit-testable. Storage access is injected.
 */
import {
	AuthError,
	CannotConnectError,
	CouchDocumentPolicyError,
	NetworkError
} from '$lib/utils/errors';

export type AuthFailureKind = 'session-expired' | 'unverified-auth' | 'offline' | 'other';

function statusOf(err: unknown): number | null {
	if (typeof err === 'number') return err;
	if (typeof err === 'object' && err !== null && 'status' in err) {
		const status = (err as { status: unknown }).status;
		return typeof status === 'number' ? status : null;
	}
	return null;
}

/** Classify a thrown error (or bare HTTP status) for session-expiry handling. */
export function classifyAuthFailure(err: unknown): AuthFailureKind {
	if (err instanceof CouchDocumentPolicyError) return 'other';
	if (err instanceof CannotConnectError || err instanceof NetworkError) return 'offline';
	if (err instanceof TypeError) return 'offline';
	if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
		if (err.name === 'AbortError' || err.name === 'TimeoutError') return 'offline';
	}

	if (err instanceof AuthError) {
		return err.status === 401 ? 'session-expired' : 'unverified-auth';
	}

	const status = statusOf(err);
	if (status === 401 || status === 403) return 'unverified-auth';
	return 'other';
}

/** True when a query must not be retried because retrying cannot succeed without a login. */
export function shouldRetryQuery(failureCount: number, err: unknown): boolean {
	const kind = classifyAuthFailure(err);
	if (kind === 'session-expired' || kind === 'unverified-auth') return false;
	return failureCount < 1;
}

export interface ExpiryLatch {
	/** True only the first time after creation / `reset()`. */
	trip(): boolean;
	reset(): void;
	readonly tripped: boolean;
}

/** Open-once de-dup: many concurrent 401s must open the modal a single time. */
export function createExpiryLatch(): ExpiryLatch {
	let tripped = false;
	return {
		trip() {
			if (tripped) return false;
			tripped = true;
			return true;
		},
		reset() {
			tripped = false;
		},
		get tripped() {
			return tripped;
		}
	};
}

/** True when a different named user replaces a previously named one. */
export function isUserSwitch(
	prev: { name: string } | null | undefined,
	next: { name: string } | null | undefined
): boolean {
	return !!prev && !!next && prev.name !== next.name;
}

// ------------------------------------------------------------------ return path

const RETURN_PATH_KEY = 'auth:return-path';
const RETURN_PATH_TTL_MS = 10 * 60 * 1000;
/** Auth-flow pages are never a useful place to return to. */
const NON_RETURN_PATHS = ['/login', '/admin-login', '/force-setup', '/mfa-challenge', '/portal'];

type ReturnStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): ReturnStorage | null {
	try {
		return typeof sessionStorage === 'undefined' ? null : sessionStorage;
	} catch {
		return null;
	}
}

/**
 * Accept only same-origin absolute paths (`/x?y#z`). Anything else — external URLs,
 * protocol-relative `//host`, backslash tricks, auth-flow pages — yields `fallback`.
 */
export function safeReturnPath<T extends string | null>(raw: unknown, fallback: T): string | T {
	if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return fallback;
	if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u001f]/.test(raw)) return fallback;
	let url: URL;
	try {
		url = new URL(raw, 'http://return-path.invalid');
	} catch {
		return fallback;
	}
	if (url.origin !== 'http://return-path.invalid') return fallback;
	const path = url.pathname;
	if (NON_RETURN_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return fallback;
	return `${path}${url.search}${url.hash}`;
}

interface ReturnPayload {
	path: string;
	user: string;
	at: number;
}

/** Remember where the expired user was. Bound to the username; no credentials stored. */
export function stashReturnPath(
	path: string,
	user: string,
	storage: ReturnStorage | null = defaultStorage(),
	now: number = Date.now()
): void {
	if (!storage) return;
	const safe = safeReturnPath(path, null);
	if (!safe) return;
	try {
		const payload: ReturnPayload = { path: safe, user, at: now };
		storage.setItem(RETURN_PATH_KEY, JSON.stringify(payload));
	} catch {
		/* storage unavailable — ignore */
	}
}

/** Consume the stash once: valid only for the same user within the TTL. */
export function takeReturnPath(
	user: string,
	storage: ReturnStorage | null = defaultStorage(),
	now: number = Date.now()
): string | null {
	if (!storage) return null;
	let raw: string | null;
	try {
		raw = storage.getItem(RETURN_PATH_KEY);
		storage.removeItem(RETURN_PATH_KEY);
	} catch {
		return null;
	}
	if (!raw) return null;
	try {
		const payload = JSON.parse(raw) as Partial<ReturnPayload>;
		if (payload.user !== user) return null;
		if (typeof payload.at !== 'number' || now - payload.at > RETURN_PATH_TTL_MS) return null;
		return safeReturnPath(payload.path, null);
	} catch {
		return null;
	}
}

export function discardReturnPath(storage: ReturnStorage | null = defaultStorage()): void {
	if (!storage) return;
	try {
		storage.removeItem(RETURN_PATH_KEY);
	} catch {
		/* ignore */
	}
}
