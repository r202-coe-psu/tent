import { z } from 'zod';

/** Scopes a partner client can be granted (EXT-001, ADR 0002). */
export const GRANTABLE_SCOPES = [
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
export type GrantableScope = (typeof GRANTABLE_SCOPES)[number];

export const SCOPE_LABEL: Record<GrantableScope, string> = {
	'location-read': 'location-read — Location Master (EXT-002/003)',
	'location-stock-read': 'location-stock-read — Shelter stock (EXT-004)',
	'occupancy-read': 'occupancy-read — Occupancy breakdown (EXT-005/006)',
	'occupancy-pii-read': 'occupancy-pii-read — Individual occupant records (EXT-007)',
	'booking-write': 'booking-write — Book / cancel shelter on behalf of citizens (EXT-008–010)',
	'booking-bypass':
		'booking-bypass — Book a shelter that is closed to bookings, EOC override (EXT-008)',
	'residency-read': 'residency-read — Per-person shelter residency by national ID (EXT-011)',
	'occupant-search':
		'occupant-search — Search persons by name / national ID / passport / phone (EXT-012)',
	'pii-full':
		'pii-full — Unmasked personal data on EXT-007 / EXT-012, with occupancy-pii-read / occupant-search (CR-257)'
};

/** Scopes that expose individual-level PII/sensitive data under PDPA — flagged in the UI. */
export const SENSITIVE_SCOPES: readonly GrantableScope[] = [
	'occupancy-pii-read',
	'booking-write',
	'booking-bypass',
	'residency-read',
	'occupant-search',
	'pii-full'
];

/** Per-scope PDPA warning shown beside each sensitive scope in the create/edit dialogs. */
export const SENSITIVE_SCOPE_WARNING: Partial<Record<GrantableScope, string>> = {
	'occupancy-pii-read':
		'Grants access to individual occupant records (PDPA-sensitive). Grant only with written approval on file for this module.',
	'booking-write':
		"Lets this partner create and cancel bookings with citizens' national ID, name and phone (PDPA-sensitive). Grant only with written approval on file for this module.",
	'booking-bypass':
		"Lets this partner book a shelter that is closed or has not switched pre-registration on, skipping the acceptance rule (EOC override; always used together with booking-write). Bookings carry citizens' national ID, name and phone (PDPA-sensitive). Grant only per case, with written approval on file for this module.",
	'residency-read':
		'Reveals whether a given national ID is staying at a shelter, and where (PDPA-sensitive). Grant only with written approval on file for this module.',
	'occupant-search':
		'Lets this partner search for people by name, national ID, passport or phone number and see their status and shelter (PDPA-sensitive). Grant only with written approval on file for this module.',
	'pii-full':
		"Lets this partner see people's full name, national ID / passport, phone number, full home address, age and household members — nothing masked — on EXT-007 and EXT-012. Works only together with occupancy-pii-read or occupant-search (PDPA-sensitive). Grant only per case, with written approval on file for this module."
};

/** Partner systems on the OAuth plane (ADR 0002; M2 added by CR-154) — a closed set. */
export const PARTNER_MODULES = ['M2', 'M6', 'M7'] as const;
export type PartnerModule = (typeof PARTNER_MODULES)[number];

export const PARTNER_MODULE_LABEL: Record<PartnerModule, string> = {
	M2: 'M2 (กลุ่มเปราะบาง)',
	M6: 'M6 (จัดการทรัพยากร)',
	M7: 'M7 (EoC)'
};

export const CLIENT_NAME_MAX_LENGTH = 100;
export const CLIENT_DESCRIPTION_MAX_LENGTH = 500;

/**
 * Preset scopes per module (schema.md §9.6) — applied when a module is picked in the
 * create form, but still freely toggleable. Sensitive scopes are never preset.
 */
export const DEFAULT_SCOPES_BY_MODULE: Record<PartnerModule, GrantableScope[]> = {
	M2: ['location-read'],
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
	/** `null` when created without a module — a module only presets scopes (CR-154 FR-62). */
	module_name: string | null;
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
	// Optional — picking a module only presets scopes (CR-154 FR-62).
	module_name: z
		.union([z.enum(PARTNER_MODULES), z.literal('')])
		.transform((value) => (value === '' ? null : value))
		.nullable()
		.optional(),
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

/** Module label for a stored `module_name` — unknown values render as-is, none as ไม่ระบุ. */
export function partnerModuleLabel(moduleName: string | null | undefined): string {
	if (!moduleName) return 'ไม่ระบุ';
	return isPartnerModule(moduleName) ? PARTNER_MODULE_LABEL[moduleName] : moduleName;
}

/** Display name — legacy clients without `name` fall back to their `client_id`. */
export function thirdPartyClientDisplayName(client: ThirdPartyClient): string {
	return client.name ?? client.client_id;
}

/** Short Thai labels for approved-scope tags. `SCOPE_LABEL` stays the long form. */
export const SCOPE_SHORT_LABEL: Record<GrantableScope, string> = {
	'location-read': 'อ่านข้อมูลศูนย์',
	'location-stock-read': 'อ่านสต็อกศูนย์',
	'occupancy-read': 'สรุปผู้พักพิง',
	'occupancy-pii-read': 'อ่านรายบุคคล',
	'booking-write': 'จอง/ยกเลิกแทนประชาชน',
	'booking-bypass': 'จองข้ามกติกา',
	'residency-read': 'ตรวจที่พักตามเลขบัตร',
	'occupant-search': 'ค้นหาบุคคล',
	'pii-full': 'ข้อมูลไม่ปิดบัง'
};

function isGrantableScope(scope: string): scope is GrantableScope {
	return (GRANTABLE_SCOPES as readonly string[]).includes(scope);
}

/** Thai tag label. Unknown scopes render the raw code. */
export function scopeShortLabel(scope: string): string {
	return isGrantableScope(scope) ? SCOPE_SHORT_LABEL[scope] : scope;
}

export function isSensitiveScope(scope: string): boolean {
	return (SENSITIVE_SCOPES as readonly string[]).includes(scope);
}

export function clientHasSensitiveScope(client: Pick<ThirdPartyClient, 'allowed_scopes'>): boolean {
	return client.allowed_scopes.some(isSensitiveScope);
}

export type ThirdPartyClientStatusFilter = 'all' | 'active' | 'revoked';

export interface ThirdPartyClientListFilter {
	query: string;
	status: ThirdPartyClientStatusFilter;
	sensitiveOnly: boolean;
}

/**
 * Free-text query matches display name, client id, description, and scope codes.
 * Status and sensitive-only both AND with that query. An empty filter keeps order.
 */
export function filterThirdPartyClients(
	clients: ThirdPartyClient[],
	filter: ThirdPartyClientListFilter
): ThirdPartyClient[] {
	const query = filter.query.trim().toLowerCase();
	return clients.filter((client) => {
		if (filter.status === 'active' && !client.is_active) return false;
		if (filter.status === 'revoked' && client.is_active) return false;
		if (filter.sensitiveOnly && !clientHasSensitiveScope(client)) return false;
		if (!query) return true;
		if (thirdPartyClientDisplayName(client).toLowerCase().includes(query)) return true;
		if (client.client_id.toLowerCase().includes(query)) return true;
		if ((client.description ?? '').toLowerCase().includes(query)) return true;
		return client.allowed_scopes.some((scope) => scope.toLowerCase().includes(query));
	});
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
