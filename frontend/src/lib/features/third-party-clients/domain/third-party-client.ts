import { z } from 'zod';

/** Scopes a partner client can be granted (EXT-001, ADR 0002). */
export const GRANTABLE_SCOPES = ['location-read', 'location-stock-read', 'occupancy-read'] as const;
export type GrantableScope = (typeof GRANTABLE_SCOPES)[number];

export const SCOPE_LABEL: Record<GrantableScope, string> = {
	'location-read': 'location-read — Location Master (EXT-002/003)',
	'location-stock-read': 'location-stock-read — Shelter stock (EXT-004)',
	'occupancy-read': 'occupancy-read — Occupancy breakdown (EXT-005/006)'
};

/** Only these two partner systems exist today (ADR 0002 / ext-spec.md) — a closed set. */
export const PARTNER_MODULES = ['M6', 'M7'] as const;
export type PartnerModule = (typeof PARTNER_MODULES)[number];

export const PARTNER_MODULE_LABEL: Record<PartnerModule, string> = {
	M6: 'M6',
	M7: 'M7'
};

export interface ThirdPartyClient {
	id: string;
	client_id: string;
	module_name: string;
	allowed_scopes: string[];
	is_active: boolean;
	created_at: string;
	updated_at: string;
}

/** Create response — plaintext `client_secret` is present once. */
export interface CreatedThirdPartyClient extends ThirdPartyClient {
	client_secret: string;
}

export const createThirdPartyClientSchema = z.object({
	client_id: z
		.string()
		.trim()
		.min(1, 'client_id is required')
		.regex(/^[a-z0-9-]+$/, 'client_id may only contain lowercase letters, digits, and hyphens'),
	module_name: z.enum(PARTNER_MODULES),
	allowed_scopes: z.array(z.enum(GRANTABLE_SCOPES)).min(1, 'Select at least one scope')
});

export type CreateThirdPartyClientInput = z.infer<typeof createThirdPartyClientSchema>;

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
