import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { APP_CONFIG_DEFAULTS, APP_CONFIG_DOC_ID, readAppConfig } from '$lib/features/shared';
import { adminRaw } from '$lib/server/couch-admin';

export function isThaidConfigured(): boolean {
	return Boolean(env.THAID_OAUTH_CLIENT_ID?.trim() && env.THAID_OAUTH_CLIENT_SECRET?.trim());
}

export async function isThaidRegistrationEnabled(): Promise<{
	enabled: boolean;
	isDev: boolean;
	mode: 'mock' | 'real';
}> {
	if (dev) {
		return { enabled: true, isDev: true, mode: 'mock' };
	}

	if (!isThaidConfigured()) {
		return { enabled: false, isDev: false, mode: 'real' };
	}

	try {
		const { status, data } = await adminRaw(
			`/registry/${encodeURIComponent(APP_CONFIG_DOC_ID)}`,
			'GET'
		);
		const config = status === 200 ? readAppConfig(data) : APP_CONFIG_DEFAULTS;
		return {
			enabled: config.thaid_registration_enabled !== false,
			isDev: false,
			mode: 'real'
		};
	} catch (err) {
		console.warn('[ThaiD] Failed to read config:app — defaulting to enabled', err);
		return { enabled: true, isDev: false, mode: 'real' };
	}
}
