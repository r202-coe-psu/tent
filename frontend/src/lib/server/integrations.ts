/**
 * Server-only client for FastAPI's outbound integration plane (`/v1/integrations/*`).
 *
 * Draft CR — referral M5 integration §1, §2. The browser never talks to FastAPI or M5: BFF
 * routes call these helpers with the Bearer `EXTERNAL_API_SECRET`. M5 credentials live in
 * FastAPI only.
 */
import { fastapiBaseUrl, fastapiServiceHeaders, unwrapFastapiError } from './fastapi';

/** Health-gate budget (CR §2): the status read must answer fast or the gate closes. */
export const STATUS_TIMEOUT_MS = 3_000;
/** Writes wait for FastAPI → M5 (FastAPI's own M5 timeout is 15 s). */
export const WRITE_TIMEOUT_MS = 20_000;

/** A failed integration call, already mapped to the HTTP status the BFF should answer. */
export class IntegrationError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		readonly extra: Record<string, unknown> = {}
	) {
		super(message);
		this.name = 'IntegrationError';
	}
}

const CENTRAL_UNAVAILABLE_MESSAGE = 'เชื่อมต่อกับระบบกลางไม่ได้';

function fallbackCode(status: number): string {
	if (status === 401 || status === 403) return 'CENTRAL_UNAUTHORIZED';
	if (status === 404) return 'NOT_FOUND';
	if (status === 422) return 'VALIDATION';
	return 'INTERNAL';
}

/**
 * Call FastAPI `/v1/integrations/*`. Network failure or timeout → `503 CENTRAL_UNAVAILABLE`;
 * an error answer → its `{code, message, …}` detail; FastAPI 5xx is reported as 503.
 */
export async function integrationRequest<T>(
	method: 'GET' | 'POST',
	path: string,
	body?: unknown,
	timeoutMs: number = WRITE_TIMEOUT_MS
): Promise<T> {
	let res: Response;
	try {
		res = await fetch(`${fastapiBaseUrl()}${path}`, {
			method,
			headers: fastapiServiceHeaders({
				Accept: 'application/json',
				...(body === undefined ? {} : { 'Content-Type': 'application/json' })
			}),
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(timeoutMs)
		});
	} catch {
		throw new IntegrationError(503, 'CENTRAL_UNAVAILABLE', CENTRAL_UNAVAILABLE_MESSAGE);
	}

	const data: unknown = await res.json().catch(() => null);
	if (res.ok) return data as T;

	const detail = unwrapFastapiError(data, fallbackCode(res.status));
	const { code, message, error, ...extra } = detail as {
		code?: unknown;
		message?: unknown;
		error?: unknown;
	} & Record<string, unknown>;
	void error;
	throw new IntegrationError(
		res.status >= 500 ? 503 : res.status,
		typeof code === 'string' ? code : fallbackCode(res.status),
		typeof message === 'string' ? message : 'ระบบกลางตอบกลับผิดพลาด',
		extra
	);
}

/** Gate state per integration (CR §2 table). */
export type IntegrationState =
	| 'ready'
	| 'central_unreachable'
	| 'm5_unavailable'
	| 'm5_not_configured'
	| 'm5_credential_invalid';

export type IntegrationStatus = {
	m5: { state: IntegrationState; checked_at: string | null };
};

type FastapiM5Status = {
	configured: boolean;
	token_ok: boolean;
	reachable: boolean;
	checked_at?: string | null;
	error?: string | null;
};

export function mapM5State(m5: FastapiM5Status): IntegrationState {
	if (!m5.configured || m5.error === 'not_configured') return 'm5_not_configured';
	if (m5.error === 'credential_invalid') return 'm5_credential_invalid';
	if (m5.token_ok && m5.reachable) return 'ready';
	return 'm5_unavailable';
}

/** Never throws: an unreachable FastAPI is a gate state, not an error. */
export async function getIntegrationStatus(): Promise<IntegrationStatus> {
	try {
		const data = await integrationRequest<{ m5: FastapiM5Status }>(
			'GET',
			'/v1/integrations/status',
			undefined,
			STATUS_TIMEOUT_MS
		);
		return { m5: { state: mapM5State(data.m5), checked_at: data.m5.checked_at ?? null } };
	} catch {
		return { m5: { state: 'central_unreachable', checked_at: null } };
	}
}
