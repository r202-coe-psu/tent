export const KIOSK_THAID_SESSION_PATH = '/api/v1/scanner/kiosk/thaid/session';
export const KIOSK_THAID_STATUS_PATH = `${KIOSK_THAID_SESSION_PATH}/status`;
export const KIOSK_THAID_CANCEL_PATH = `${KIOSK_THAID_SESSION_PATH}/cancel`;
export const KIOSK_THAID_CREATE_TIMEOUT_MS = 10_000;
export const KIOSK_THAID_STATUS_TIMEOUT_MS = 5_000;
export const KIOSK_THAID_CANCEL_TIMEOUT_MS = 5_000;

export interface KioskThaidSession {
	sessionId: string;
	qrUrl: string;
	/** Unix ms. */
	expiresAt: number;
}

/** Why a ThaiD session request failed, in the terms the kiosk screen cares about. */
export type KioskThaidErrorKind = 'disabled' | 'rate_limited' | 'unavailable';

export class KioskThaidError extends Error {
	readonly kind: KioskThaidErrorKind;

	constructor(
		readonly status: number,
		readonly code: string | null,
		readonly retryAfterSeconds: number | null = null
	) {
		super(`kiosk thaid request failed (${status}${code ? ` ${code}` : ''})`);
		this.name = 'KioskThaidError';
		this.kind =
			code === 'KIOSK_METHOD_DISABLED'
				? 'disabled'
				: status === 429
					? 'rate_limited'
					: 'unavailable';
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
	};
	return { sessionId: body.session_id, qrUrl: body.qr_url, expiresAt: body.expires_at };
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

/** `expiresAt` (Unix ms) is absent when the server no longer knows the session (404 = expired). */
export interface KioskThaidStatusResult {
	status: KioskThaidSessionStatus;
	expiresAt?: number;
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
	} | null;
	if (typeof body?.status !== 'string' || !STATUSES.includes(body.status)) {
		throw new KioskThaidError(response.status, 'INVALID_RESPONSE');
	}
	return {
		status: body.status as KioskThaidSessionStatus,
		...(typeof body.expires_at === 'number' ? { expiresAt: body.expires_at } : {})
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
