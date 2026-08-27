import { z } from 'zod';

/**
 * `config:app` — the app-wide singleton in the `registry` database (schema.md §3.2).
 *
 * Cross-cutting by nature: a donation TTL, a registration match threshold and a PDPA
 * retention window share one document, so it lives in `shared` rather than under any one
 * feature.
 *
 * Every field is optional on read. The document is central-managed and replicates down
 * to devices, so a client can meet a version of it written by a newer or older release —
 * missing or malformed values fall back to the spec default rather than failing the read
 * outright, which for a config document would take down whatever depends on it.
 */
export const APP_CONFIG_DOC_ID = 'config:app';

export const appConfigSchema = z.object({
	public_otp_required: z.boolean().catch(false),
	duplicate_hint_threshold: z.coerce.number().min(0).max(1).catch(0.8),
	donation_reservation_ttl_hours: z.coerce.number().int().positive().catch(72),
	device_db_ttl_days: z.coerce.number().int().positive().catch(30),
	retention_months_after_close: z.coerce.number().int().positive().catch(3),
	fam_search_max_results: z.coerce.number().int().positive().catch(10)
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export const APP_CONFIG_DEFAULTS: AppConfig = appConfigSchema.parse({});

export const isAppConfig = (d: unknown): d is { type: 'config' } =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'config';

/**
 * Read a raw `config:app` document into settled values.
 *
 * Per-field `.catch()` means one bad value costs only that field — a typo in
 * `fam_search_max_results` must not silently reset the donation TTL alongside it.
 */
export function readAppConfig(doc: unknown): AppConfig {
	if (!doc || typeof doc !== 'object') return APP_CONFIG_DEFAULTS;
	const parsed = appConfigSchema.safeParse(doc);
	return parsed.success ? parsed.data : APP_CONFIG_DEFAULTS;
}
