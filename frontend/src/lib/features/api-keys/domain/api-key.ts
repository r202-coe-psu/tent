import { z } from 'zod';

/** Lifecycle status derived from revoke + expiry timestamps. */
export type ApiKeyStatus = 'active' | 'expired' | 'revoked';

/** Metadata row (never includes the plaintext secret after create). */
export interface ApiKey {
	id: string;
	name: string;
	owner: string;
	key_prefix: string;
	expires_at: string;
	created_by: string;
	created_at: string;
	revoked_at: string | null;
}

/** Create response — plaintext `api_key` is present once. */
export interface CreatedApiKey extends ApiKey {
	api_key: string;
}

/** Quick-pick durations (days). Users may also type any positive integer. */
export const DURATION_PRESETS = [30, 60, 90, 180, 365] as const;
export type DurationPresetDays = (typeof DURATION_PRESETS)[number];

export const createApiKeySchema = z.object({
	name: z.string().trim().min(1, 'Name is required'),
	owner: z.string().trim().min(1, 'Owner is required'),
	duration_days: z.coerce
		.number()
		.int('Duration must be a whole number of days')
		.min(1, 'Duration must be at least 1 day')
		.max(3650, 'Duration must be at most 3650 days')
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

/** Resolve ISO expiry from duration in days (UTC). */
export function resolveExpiresAt(input: CreateApiKeyInput, now: Date = new Date()): string {
	const d = new Date(now.getTime());
	d.setUTCDate(d.getUTCDate() + input.duration_days);
	return d.toISOString();
}

export function apiKeyStatus(
	key: Pick<ApiKey, 'expires_at' | 'revoked_at'>,
	now: Date = new Date()
): ApiKeyStatus {
	if (key.revoked_at) return 'revoked';
	const expiresMs = Date.parse(key.expires_at);
	if (!Number.isNaN(expiresMs) && expiresMs <= now.getTime()) return 'expired';
	return 'active';
}

export const API_KEY_STATUS_LABEL: Record<ApiKeyStatus, string> = {
	active: 'Active',
	expired: 'Expired',
	revoked: 'Revoked'
};

/** Normalize list payloads from FastAPI (array or wrapped). */
export function normalizeApiKeyList(payload: unknown): ApiKey[] {
	if (Array.isArray(payload)) return payload as ApiKey[];
	if (typeof payload === 'object' && payload !== null) {
		const obj = payload as {
			keys?: unknown;
			items?: unknown;
			api_keys?: unknown;
			data?: unknown;
		};
		// Prefer `keys` — matches FastAPI `ApiKeyListResponse`.
		if (Array.isArray(obj.keys)) return obj.keys as ApiKey[];
		if (Array.isArray(obj.items)) return obj.items as ApiKey[];
		if (Array.isArray(obj.api_keys)) return obj.api_keys as ApiKey[];
		if (Array.isArray(obj.data)) return obj.data as ApiKey[];
	}
	return [];
}

/** Normalize revoke payloads — FastAPI returns `{ success, key }`. */
export function normalizeRevokedApiKey(payload: unknown): ApiKey {
	if (typeof payload === 'object' && payload !== null) {
		const obj = payload as { key?: unknown; id?: unknown };
		if (typeof obj.key === 'object' && obj.key !== null && 'id' in (obj.key as object)) {
			return obj.key as ApiKey;
		}
		if (typeof obj.id === 'string') {
			return payload as ApiKey;
		}
	}
	throw new Error('Unexpected revoke response shape');
}
