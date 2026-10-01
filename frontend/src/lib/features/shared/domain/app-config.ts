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

export const BANNER_VARIANTS = ['success', 'warning', 'destructive', 'info'] as const;
export const BANNER_MESSAGE_MAX = 120;

export const bannerVariantSchema = z.enum(BANNER_VARIANTS);
export type BannerVariant = z.infer<typeof bannerVariantSchema>;

/** Single line, trimmed, ≤ {@link BANNER_MESSAGE_MAX}. Strict — used for writes (no `.catch`). */
export const bannerMessageSchema = z
	.string()
	.trim()
	.max(BANNER_MESSAGE_MAX)
	.regex(/^[^\r\n]*$/, 'Banner message must be a single line');

export const appConfigSchema = z.object({
	public_otp_required: z.boolean().catch(false),
	/** Operator kill-switch for reCAPTCHA; keys in env are still required when ON. */
	recaptcha_enabled: z.boolean().catch(true),
	/** Operator kill-switch for ThaiD Digital ID registration on public pre-register page. */
	thaid_registration_enabled: z.boolean().catch(true),
	/** Show username/password on `/login` (CR-141). OFF = OAuth only; `/admin-login` always shows it. */
	password_login_enabled: z.boolean().catch(false),
	/** System banner (bottom of every route). Shown only when enabled AND message non-empty. */
	banner_enabled: z.boolean().catch(false),
	banner_message: bannerMessageSchema.catch(''),
	banner_variant: bannerVariantSchema.catch('warning'),
	duplicate_hint_threshold: z.coerce.number().min(0).max(1).catch(0.8),
	donation_reservation_ttl_hours: z.coerce.number().int().positive().catch(72),
	device_db_ttl_days: z.coerce.number().int().positive().catch(30),
	retention_months_after_close: z.coerce.number().int().positive().catch(3),
	fam_search_max_results: z.coerce.number().int().positive().catch(10)
});

export type AppConfig = z.infer<typeof appConfigSchema>;

/** Fields an SA may change via `PUT /api/v1/app-config`. */
export type AppConfigPatchKey =
	| 'recaptcha_enabled'
	| 'thaid_registration_enabled'
	| 'password_login_enabled'
	| 'banner_enabled'
	| 'banner_message'
	| 'banner_variant';

/** Strict (no `.catch`) banner fields for `PUT /api/v1/app-config`: bad input rejects, never defaults. */
export const bannerPatchSchema = z.object({
	banner_enabled: z.boolean(),
	banner_message: bannerMessageSchema,
	banner_variant: bannerVariantSchema
});

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

export type SystemBanner = {
	enabled: boolean;
	message: string;
	variant: BannerVariant;
};

/** The banner renders only when switched on and there is something to say. */
export const isBannerVisible = (
	cfg: Pick<AppConfig, 'banner_enabled' | 'banner_message'>
): boolean => cfg.banner_enabled && cfg.banner_message.trim() !== '';

/** Public projection of the banner settings; a hidden banner is reported as disabled. */
export function toSystemBanner(cfg: AppConfig): SystemBanner {
	return isBannerVisible(cfg)
		? { enabled: true, message: cfg.banner_message, variant: cfg.banner_variant }
		: { enabled: false, message: '', variant: cfg.banner_variant };
}
