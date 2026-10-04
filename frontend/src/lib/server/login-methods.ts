import { APP_CONFIG_DEFAULTS, APP_CONFIG_DOC_ID, readAppConfig } from '$lib/features/shared';
import { adminRaw } from '$lib/server/couch-admin';
import { isGoogleConfigured } from '$lib/server/google-oauth';
import { isThaidRegistrationEnabled } from '$lib/server/thaid-registration-gate';

/** Which sign-in methods `/login` offers (CR-141). `/admin-login` ignores `password`. */
export interface LoginMethods {
	password: boolean;
	google: boolean;
	thaid: boolean;
}

/** Read `config:app.password_login_enabled`; unreadable config → default (OFF). */
async function readPasswordLoginEnabled(): Promise<boolean> {
	try {
		const { status, data } = await adminRaw(
			`/registry/${encodeURIComponent(APP_CONFIG_DOC_ID)}`,
			'GET'
		);
		const config = status === 200 ? readAppConfig(data) : APP_CONFIG_DEFAULTS;
		return config.password_login_enabled;
	} catch (err) {
		console.warn('[login-methods] Failed to read config:app — password form stays hidden', err);
		return APP_CONFIG_DEFAULTS.password_login_enabled;
	}
}

export async function resolveLoginMethods(): Promise<LoginMethods> {
	const [password, thaid] = await Promise.all([
		readPasswordLoginEnabled(),
		isThaidRegistrationEnabled()
	]);
	return { password, google: isGoogleConfigured(), thaid: thaid.enabled };
}
