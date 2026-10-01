import {
	APP_CONFIG_DEFAULTS,
	APP_CONFIG_DOC_ID,
	readAppConfig,
	toSystemBanner,
	type SystemBanner
} from '$lib/features/shared';
import { adminRaw } from '$lib/server/couch-admin';

/** Public view of `config:app.banner_*`; unreadable config → banner hidden. */
export async function readSystemBanner(): Promise<SystemBanner> {
	try {
		const { status, data } = await adminRaw(
			`/registry/${encodeURIComponent(APP_CONFIG_DOC_ID)}`,
			'GET'
		);
		return toSystemBanner(status === 200 ? readAppConfig(data) : APP_CONFIG_DEFAULTS);
	} catch (err) {
		console.warn('[system-banner] Failed to read config:app — banner stays hidden', err);
		return toSystemBanner(APP_CONFIG_DEFAULTS);
	}
}
