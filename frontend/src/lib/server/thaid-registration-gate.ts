import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { APP_CONFIG_DEFAULTS, APP_CONFIG_DOC_ID, readAppConfig } from '$lib/features/shared';
import { adminRaw } from '$lib/server/couch-admin';

export function isThaidConfigured(): boolean {
	return Boolean(env.THAID_OAUTH_CLIENT_ID?.trim() && env.THAID_OAUTH_CLIENT_SECRET?.trim());
}

/**
 * Whether ThaiD should be offered in the UI / OAuth start (login, /me link, pre-register).
 *
 * Operator flag `config:app.thaid_registration_enabled` always wins when OFF.
 * When ON: enabled if OAuth keys are configured, or DEV mock when keys are missing.
 * MFA step-up for already-linked accounts is gated separately by the caller.
 */
export async function isThaidRegistrationEnabled(): Promise<{
	enabled: boolean;
	isDev: boolean;
	mode: 'mock' | 'real';
}> {
	const configured = isThaidConfigured();

	try {
		const { status, data } = await adminRaw(
			`/registry/${encodeURIComponent(APP_CONFIG_DOC_ID)}`,
			'GET'
		);
		const config = status === 200 ? readAppConfig(data) : APP_CONFIG_DEFAULTS;
		const flagOn = config.thaid_registration_enabled !== false;

		if (!flagOn) {
			return { enabled: false, isDev: dev, mode: configured ? 'real' : 'mock' };
		}

		if (configured) {
			return { enabled: true, isDev: false, mode: 'real' };
		}
		if (dev) {
			return { enabled: true, isDev: true, mode: 'mock' };
		}
		return { enabled: false, isDev: false, mode: 'real' };
	} catch (err) {
		console.warn('[ThaiD] Failed to read config:app — defaulting to enabled when possible', err);
		if (configured) {
			return { enabled: true, isDev: false, mode: 'real' };
		}
		if (dev) {
			return { enabled: true, isDev: true, mode: 'mock' };
		}
		return { enabled: false, isDev: false, mode: 'real' };
	}
}
