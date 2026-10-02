import { z } from 'zod';

/** Scopes a partner client can be granted (EXT-001, ADR 0002). */
export const GRANTABLE_SCOPES = [
	'location-read',
	'location-stock-read',
	'occupancy-read',
	'occupancy-pii-read'
] as const;
export type GrantableScope = (typeof GRANTABLE_SCOPES)[number];

export const SCOPE_LABEL: Record<GrantableScope, string> = {
	'location-read': 'location-read — Location Master (EXT-002/003)',
	'location-stock-read': 'location-stock-read — Shelter stock (EXT-004)',
	'occupancy-read': 'occupancy-read — Occupancy breakdown (EXT-005/006)',
	'occupancy-pii-read': 'occupancy-pii-read — Individual occupant records (EXT-007)'
};

/** Scopes that expose individual-level PII/sensitive data under PDPA — flagged in the UI. */
export const SENSITIVE_SCOPES: readonly GrantableScope[] = ['occupancy-pii-read'];

/** Only these two partner systems exist today (ADR 0002 / ext-spec.md) — a closed set. */
export const PARTNER_MODULES = ['M6', 'M7'] as const;
export type PartnerModule = (typeof PARTNER_MODULES)[number];

export const PARTNER_MODULE_LABEL: Record<PartnerModule, string> = {
	M6: 'M6 (จัดการทรัพยากร)',
	M7: 'M7 (EoC)'
};

export const CLIENT_NAME_MAX_LENGTH = 100;
export const CLIENT_DESCRIPTION_MAX_LENGTH = 500;

/**
 * Preset scopes per module (schema.md §9.6) — applied when a module is picked in the
 * create form, but still freely toggleable. `occupancy-pii-read` is never preset.
 */
export const DEFAULT_SCOPES_BY_MODULE: Record<PartnerModule, GrantableScope[]> = {
	M6: ['location-read', 'location-stock-read'],
	M7: ['location-read', 'location-stock-read', 'occupancy-read']
};

export interface ThirdPartyClient {
	id: string;
	/** Server-generated `tpc_…`; clients created before generation keep their typed id. */
	client_id: string;
	/** `null` only on clients created before the field existed. */
	name: string | null;
	description: string | null;
	module_name: string;
	allowed_scopes: string[];
	is_active: boolean;
	/** Soft-delete timestamp — the list endpoint never returns a row once this is set. */
	deleted_at: string | null;
	created_at: string;
	updated_at: string;
}

/** Create response — plaintext `client_secret` is present once. */
export interface CreatedThirdPartyClient extends ThirdPartyClient {
	client_secret: string;
}

/** `client_id` is generated server-side — not part of the create input. */
export const createThirdPartyClientSchema = z.object({
	name: z
		.string()
		.trim()
		.min(1, 'Name is required')
		.max(CLIENT_NAME_MAX_LENGTH, `Name must be at most ${CLIENT_NAME_MAX_LENGTH} characters`),
	description: z
		.string()
		.trim()
		.max(
			CLIENT_DESCRIPTION_MAX_LENGTH,
			`Description must be at most ${CLIENT_DESCRIPTION_MAX_LENGTH} characters`
		)
		.transform((value) => (value === '' ? null : value))
		.nullable()
		.optional(),
	module_name: z.enum(PARTNER_MODULES, { error: 'Select a module' }),
	allowed_scopes: z.array(z.enum(GRANTABLE_SCOPES)).min(1, 'Select at least one scope')
});

export type CreateThirdPartyClientInput = z.infer<typeof createThirdPartyClientSchema>;

/** `PATCH` body — scopes only; refused (409) once the client is revoked. */
export const updateThirdPartyClientScopesSchema = z.object({
	allowed_scopes: z.array(z.enum(GRANTABLE_SCOPES)).min(1, 'Select at least one scope')
});

export type UpdateThirdPartyClientScopesInput = z.infer<typeof updateThirdPartyClientScopesSchema>;

/** Reveal-secret gate — the caller's own password, re-checked against CouchDB. */
export const revealThirdPartyClientSecretSchema = z.object({
	password: z.string().min(1, 'Password is required')
});

export type RevealThirdPartyClientSecretInput = z.infer<typeof revealThirdPartyClientSecretSchema>;

export function isPartnerModule(value: string): value is PartnerModule {
	return (PARTNER_MODULES as readonly string[]).includes(value);
}

/** Module label for a stored `module_name` — unknown values render as-is. */
export function partnerModuleLabel(moduleName: string): string {
	return isPartnerModule(moduleName) ? PARTNER_MODULE_LABEL[moduleName] : moduleName;
}

/** Display name — legacy clients without `name` fall back to their `client_id`. */
export function thirdPartyClientDisplayName(client: ThirdPartyClient): string {
	return client.name ?? client.client_id;
}

/** Normalize list payloads from FastAPI (array or wrapped). */
export function normalizeThirdPartyClientList(payload: unknown): ThirdPartyClient[] {
	if (Array.isArray(payload)) return payload as ThirdPartyClient[];
	if (typeof payload === 'object' && payload !== null) {
		const obj = payload as { clients?: unknown; items?: unknown; data?: unknown };
		if (Array.isArray(obj.clients)) return obj.clients as ThirdPartyClient[];
		if (Array.isArray(obj.items)) return obj.items as ThirdPartyClient[];
		if (Array.isArray(obj.data)) return obj.data as ThirdPartyClient[];
	}
	return [];
}

/** Normalize revoke payloads — FastAPI returns `{ success, client }`. */
export function normalizeRevokedThirdPartyClient(payload: unknown): ThirdPartyClient {
	if (typeof payload === 'object' && payload !== null) {
		const obj = payload as { client?: unknown; id?: unknown };
		if (typeof obj.client === 'object' && obj.client !== null && 'id' in (obj.client as object)) {
			return obj.client as ThirdPartyClient;
		}
		if (typeof obj.id === 'string') {
			return payload as ThirdPartyClient;
		}
	}
	throw new Error('Unexpected revoke response shape');
}

/** Normalize soft-delete payloads — FastAPI returns the same `{ success, client }` shape. */
export const normalizeDeletedThirdPartyClient = normalizeRevokedThirdPartyClient;

/** Normalize the reveal-secret response `{ client_secret }`. */
export function normalizeRevealedSecret(payload: unknown): string {
	if (typeof payload === 'object' && payload !== null) {
		const secret = (payload as { client_secret?: unknown }).client_secret;
		if (typeof secret === 'string' && secret) return secret;
	}
	throw new Error('Unexpected secret reveal response shape');
}
