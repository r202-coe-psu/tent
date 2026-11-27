/**
 * Partner plane (`/external/*`, OAuth2 client_credentials + JWT, ADR 0002) for the external API
 * suites. Clients are managed through `/v1/admin/thirdparty-clients` with `EXTERNAL_API_SECRET`,
 * the same FastAPI routes the staff BFF behind System management → API Keys calls. Every client a
 * run creates is named `PERMTEST partner …` and is revoked, then soft-deleted, at the end.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { fastapiTarget } from './env.ts';
import { callFastapi, type ApiResult } from './fastapi.ts';

/** The nine grantable scopes (`tent_model.third_party_client.THIRD_PARTY_SCOPES`). */
export const PARTNER_SCOPES = [
	'location-read',
	'location-stock-read',
	'occupancy-read',
	'occupancy-pii-read',
	'booking-write',
	'booking-bypass',
	'residency-read',
	'occupant-search',
	'pii-full'
] as const;

export type PartnerScope = (typeof PARTNER_SCOPES)[number];

export interface PartnerClientMeta {
	id: string;
	client_id: string;
	name: string | null;
	description: string | null;
	module_name: string | null;
	allowed_scopes: string[];
	is_active: boolean;
	deleted_at: string | null;
	created_at: string;
	updated_at: string;
}

export interface PartnerClient extends PartnerClientMeta {
	/** Plaintext secret, returned once. Never log or assert on its value. */
	client_secret: string;
}

export interface Token {
	access_token: string;
	token_type: string;
	expires_in: number;
	module_name: string | null;
	scopes: string[];
}

const ADMIN_PATH = '/v1/admin/thirdparty-clients';

function asAdmin(): Record<string, string> {
	return { Authorization: `Bearer ${fastapiTarget().adminSecret}` };
}

export function adminClients<T = unknown>(
	method: string,
	path = '',
	body?: unknown
): Promise<ApiResult<T>> {
	return callFastapi<T>(`${ADMIN_PATH}${path}`, { method, headers: asAdmin(), body });
}

/**
 * Creates and remembers partner clients so `cleanup()` can revoke and soft-delete all of them,
 * whatever state a failed test left them in.
 */
export class PartnerClients {
	private readonly created = new Map<string, PartnerClient>();

	constructor(private readonly run: string) {}

	async create(
		label: string,
		scopes: readonly PartnerScope[],
		moduleName: string | null = null
	): Promise<PartnerClient> {
		const res = await adminClients<PartnerClient>('POST', '', {
			name: `PERMTEST partner ${label} ${this.run}`,
			module_name: moduleName,
			allowed_scopes: scopes
		});
		if (res.status !== 201) {
			throw new Error(`Could not create partner client ${label} (HTTP ${res.status})`);
		}
		this.created.set(res.body.id, res.body);
		return res.body;
	}

	/** A token for a fresh client that holds exactly `scopes`. */
	async tokenWith(label: string, scopes: readonly PartnerScope[]): Promise<string> {
		const client = await this.create(label, scopes);
		return (await mintToken(client.client_id, client.client_secret)).access_token;
	}

	async cleanup(): Promise<void> {
		for (const id of this.created.keys()) {
			await adminClients('POST', `/${id}/revoke`).catch(() => undefined);
			await adminClients('DELETE', `/${id}`).catch(() => undefined);
		}
		this.created.clear();
	}
}

export function postToken(body: unknown): Promise<ApiResult<Token>> {
	return callFastapi<Token>('/external/token', { method: 'POST', body });
}

export async function mintToken(clientId: string, secret: string): Promise<Token> {
	const res = await postToken({
		grant_type: 'client_credentials',
		client_id: clientId,
		client_secret: secret
	});
	if (res.status !== 200)
		throw new Error(`Could not mint a token for ${clientId} (HTTP ${res.status})`);
	return res.body;
}

export interface ExtCall {
	method?: 'GET' | 'POST';
	query?: Record<string, string>;
	body?: unknown;
	headers?: Record<string, string>;
}

/** Call an `/external/*` path; `token = null` sends no Authorization header. */
export function callExt<T = any>(
	token: string | null,
	path: string,
	{ method = 'GET', query, body, headers = {} }: ExtCall = {}
): Promise<ApiResult<T>> {
	const qs = query ? `?${new URLSearchParams(query)}` : '';
	return callFastapi<T>(`${path}${qs}`, {
		method,
		body,
		headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }
	});
}

/** Every partner-plane error body is `{status, message, code}` (apiapp/core/http_error.py). */
export function extCode(res: ApiResult): string | undefined {
	return (res.body as { code?: string } | null)?.code;
}

// ─── Tokens made by hand ────────────────────────────────────────────────────────

const b64url = (value: unknown) =>
	Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

/** An HS256 JWT signed with `key` — to prove the server checks the signature and expiry. */
export function signJwt(claims: Record<string, unknown>, key: string): string {
	const head = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(claims)}`;
	return `${head}.${createHmac('sha256', key).update(head).digest('base64url')}`;
}

/** An unsigned (`alg: none`) JWT claiming every scope. */
export function unsignedJwt(claims: Record<string, unknown>): string {
	return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(claims)}.`;
}

/** A random key that is certainly not the server's signing key. */
export const wrongKey = () => randomBytes(32).toString('hex');

/** Claims shaped like the server's own (`mint_access_token`). */
export function claims(scopes: readonly string[], expiresInS = 600): Record<string, unknown> {
	const now = Math.floor(Date.now() / 1000);
	return {
		sub: 'tpc_permtest_forged',
		module_name: null,
		scope: scopes.join(' '),
		iat: now,
		exp: now + expiresInS
	};
}

// ─── National IDs ───────────────────────────────────────────────────────────────

/**
 * A checksum-valid 13-digit national ID that starts with 0, so it can never belong to a real
 * person (real IDs start with 1–8). Unique per call within a run.
 */
let cidSeq = 0;
export function fictitiousCid(): string {
	cidSeq += 1;
	const body = `0${String(Date.now() % 1e9).padStart(9, '0')}${String(cidSeq % 1000)
		.padStart(2, '0')
		.slice(-2)}`;
	const twelve = body.slice(0, 12);
	const sum = [...twelve].reduce((acc, d, i) => acc + Number(d) * (13 - i), 0);
	return `${twelve}${(11 - (sum % 11)) % 10}`;
}
