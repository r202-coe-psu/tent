export const KIOSK_THAID_SESSION_PATH = '/api/v1/scanner/kiosk/thaid/session';
export const KIOSK_THAID_STATUS_PATH = `${KIOSK_THAID_SESSION_PATH}/status`;
export const KIOSK_THAID_CANCEL_PATH = `${KIOSK_THAID_SESSION_PATH}/cancel`;
export const KIOSK_THAID_CREATE_TIMEOUT_MS = 10_000;
export const KIOSK_THAID_STATUS_TIMEOUT_MS = 5_000;
export const KIOSK_THAID_CANCEL_TIMEOUT_MS = 5_000;

export interface KioskThaidSession {
	sessionId: string;
	qrUrl: string;
	/** Unix ms by the server clock: not comparable with the kiosk clock, prefer `expiresInSec`. */
	expiresAt: number;
	/** Seconds left by the server clock when it answered; immune to the kiosk clock being off. */
	expiresInSec?: number;
}

/** Why a ThaiD session request failed, in the terms the kiosk screen cares about. */
export type KioskThaidErrorKind =
	| 'disabled'
	| 'rate_limited'
	/** 401 / 403: this kiosk is not (or no longer) allowed; retrying the same call cannot help. */
	| 'unauthorized'
	/** Any other 4xx (e.g. 400): the request itself is wrong; retrying cannot help. */
	| 'invalid'
	/** Network error, timeout, 5xx, unreadable reply: worth trying again. */
	| 'unavailable';

function kindOf(status: number, code: string | null): KioskThaidErrorKind {
	if (code === 'KIOSK_METHOD_DISABLED') return 'disabled';
	if (status === 429) return 'rate_limited';
	if (status === 401 || status === 403) return 'unauthorized';
	if (status >= 400 && status < 500 && status !== 408) return 'invalid';
	return 'unavailable';
}

export class KioskThaidError extends Error {
	readonly kind: KioskThaidErrorKind;

	constructor(
		readonly status: number,
		readonly code: string | null,
		readonly retryAfterSeconds: number | null = null
	) {
		super(`kiosk thaid request failed (${status}${code ? ` ${code}` : ''})`);
		this.name = 'KioskThaidError';
		this.kind = kindOf(status, code);
	}
}

async function errorFromResponse(response: Response): Promise<KioskThaidError> {
	const body = (await response.json().catch(() => null)) as { error?: { code?: unknown } } | null;
	const code = typeof body?.error?.code === 'string' ? body.error.code : null;
	const retryAfter = Number(response.headers.get('retry-after'));
	return new KioskThaidError(
		response.status,
		code,
		Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null
	);
}

async function post(path: string, timeoutMs: number, body?: unknown): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(path, {
			method: 'POST',
			cache: 'no-store',
			...(body === undefined
				? {}
				: { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
			signal: controller.signal
		});
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			throw new KioskThaidError(0, 'TIMEOUT');
		}
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

/** Start a ThaiD scan session bound to this kiosk; the QR points a phone at the ThaiD OAuth start. */
export async function createKioskThaidSession(): Promise<KioskThaidSession> {
	const response = await post(KIOSK_THAID_SESSION_PATH, KIOSK_THAID_CREATE_TIMEOUT_MS);
	if (!response.ok) throw await errorFromResponse(response);
	const body = (await response.json()) as {
		session_id: string;
		qr_url: string;
		expires_at: number;
		expires_in_sec?: unknown;
	};
	return {
		sessionId: body.session_id,
		qrUrl: body.qr_url,
		expiresAt: body.expires_at,
		...(typeof body.expires_in_sec === 'number' ? { expiresInSec: body.expires_in_sec } : {})
	};
}

export type KioskThaidSessionStatus =
	'pending' | 'completed' | 'cancelled' | 'consumed' | 'expired';

const STATUSES: readonly string[] = [
	'pending',
	'completed',
	'cancelled',
	'consumed',
	'expired'
] satisfies KioskThaidSessionStatus[];

/** The expiry fields are absent when the server no longer knows the session (404 = expired). */
export interface KioskThaidStatusResult {
	status: KioskThaidSessionStatus;
	/** Unix ms by the server clock. */
	expiresAt?: number;
	/** Seconds left by the server clock when it answered. */
	expiresInSec?: number;
}

/** Poll the session; carries no personal data, only the status. */
export async function getKioskThaidSessionStatus(
	sessionId: string
): Promise<KioskThaidStatusResult> {
	const response = await post(KIOSK_THAID_STATUS_PATH, KIOSK_THAID_STATUS_TIMEOUT_MS, {
		session_id: sessionId
	});
	if (response.status === 404) return { status: 'expired' };
	if (!response.ok) throw await errorFromResponse(response);
	const body = (await response.json().catch(() => null)) as {
		status?: unknown;
		expires_at?: unknown;
		expires_in_sec?: unknown;
	} | null;
	if (typeof body?.status !== 'string' || !STATUSES.includes(body.status)) {
		throw new KioskThaidError(response.status, 'INVALID_RESPONSE');
	}
	return {
		status: body.status as KioskThaidSessionStatus,
		...(typeof body.expires_at === 'number' ? { expiresAt: body.expires_at } : {}),
		...(typeof body.expires_in_sec === 'number' ? { expiresInSec: body.expires_in_sec } : {})
	};
}

/** Best effort and idempotent on the server: never throws (leaving the page must not fail). */
export async function cancelKioskThaidSession(sessionId: string): Promise<void> {
	try {
		await post(KIOSK_THAID_CANCEL_PATH, KIOSK_THAID_CANCEL_TIMEOUT_MS, { session_id: sessionId });
	} catch {
		// The session expires on its own; nothing useful to tell the visitor.
	}
}
