/**
 * Minimal FastAPI client for the external API suites. The admin calls (issue / list / revoke
 * API keys) carry `EXTERNAL_API_SECRET` the way the staff BFF does; every assertion is made
 * with the credential an outside agency would hold. Nothing goes through the app, so a result
 * shows what FastAPI itself enforces.
 */
import { fastapiTarget } from './env.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response shapes differ per route
export interface ApiResult<T = any> {
	status: number;
	/** Response headers, names in lower case. */
	headers: Record<string, string>;
	body: T;
}

export interface ApiRequest {
	method?: string;
	headers?: Record<string, string>;
	body?: unknown;
}

export async function callFastapi<T = unknown>(
	path: string,
	{ method = 'GET', headers = {}, body }: ApiRequest = {}
): Promise<ApiResult<T>> {
	const res = await fetch(`${fastapiTarget().base}${path}`, {
		method,
		headers: {
			Accept: 'application/json',
			...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
			...headers
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const text = await res.text();
	let parsed: unknown = text;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		// Not JSON (an HTML error page, say): keep the text so the assertion message shows it.
	}
	return { status: res.status, headers: Object.fromEntries(res.headers), body: parsed as T };
}

/** True when FastAPI answers its health check — the suites skip without it. */
export async function fastapiIsUp(): Promise<boolean> {
	try {
		return (await callFastapi('/v1/health')).status === 200;
	} catch {
		return false;
	}
}

/**
 * The error code of a FastAPI error body. `/external/v1` answers `{error: {code}}`; a route
 * that leaves the default handler alone answers `{detail: {error: {code}}}`.
 */
export function errorCode(body: unknown): string | undefined {
	const b = body as { error?: { code?: string }; detail?: { error?: { code?: string } } } | null;
	return b?.error?.code ?? b?.detail?.error?.code;
}

// ─── API keys (CR-062) ──────────────────────────────────────────────────────────

/** Key metadata as `/v1/admin/api-keys` lists it (never the secret or its hash). */
export interface ApiKeyMeta {
	id: string;
	name: string;
	owner: string;
	key_prefix: string;
	expires_at: string;
	created_by: string;
	created_at: string;
	revoked_at: string | null;
	last_used_at: string | null;
}

export interface IssuedKey extends ApiKeyMeta {
	/** Plaintext `tsk_…` secret, returned once at issue. Never log or assert on its value. */
	api_key: string;
}

function asAdmin(): Record<string, string> {
	return { Authorization: `Bearer ${fastapiTarget().adminSecret}` };
}

/** Issue a key the way SA does in System management → API Keys (via the staff BFF). */
export async function issueApiKey(name: string, validForMs = 24 * 3_600_000): Promise<IssuedKey> {
	const res = await callFastapi<IssuedKey>('/v1/admin/api-keys', {
		method: 'POST',
		headers: asAdmin(),
		body: {
			name,
			owner: 'PERMTEST',
			expires_at: new Date(Date.now() + validForMs).toISOString(),
			created_by: 'permtest'
		}
	});
	if (res.status !== 201) throw new Error(`Could not issue API key ${name} (HTTP ${res.status})`);
	return res.body;
}

export async function listApiKeys(): Promise<ApiResult<{ keys: ApiKeyMeta[]; count: number }>> {
	return callFastapi('/v1/admin/api-keys', { headers: asAdmin() });
}

/**
 * Revoke a key. Keys cannot be deleted (CR-062 keeps the row for audit), so a run leaves its
 * `PERMTEST` keys behind revoked.
 */
export async function revokeApiKey(id: string): Promise<void> {
	const res = await callFastapi(`/v1/admin/api-keys/${encodeURIComponent(id)}/revoke`, {
		method: 'POST',
		headers: asAdmin()
	});
	if (res.status !== 200) throw new Error(`Could not revoke API key ${id} (HTTP ${res.status})`);
}
