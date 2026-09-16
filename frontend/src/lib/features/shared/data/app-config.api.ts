import type { AppConfig } from '../domain/app-config';

export type AppConfigResponse = {
	config: AppConfig;
	exists: boolean;
	rev?: string | null;
};

export async function fetchAppConfig(fetchFn: typeof fetch = fetch): Promise<AppConfigResponse> {
	const res = await fetchFn('/api/v1/app-config', {
		headers: { Accept: 'application/json' },
		credentials: 'include'
	});
	const body = (await res.json().catch(() => null)) as
		| AppConfigResponse
		| { error?: { message?: string } }
		| null;
	if (!res.ok) {
		const message =
			body && typeof body === 'object' && 'error' in body && body.error?.message
				? body.error.message
				: `Failed to load app config (${res.status})`;
		throw new Error(message);
	}
	return body as AppConfigResponse;
}

export async function updateAppConfig(
	patch: Pick<AppConfig, 'recaptcha_enabled'>,
	fetchFn: typeof fetch = fetch
): Promise<AppConfig> {
	const res = await fetchFn('/api/v1/app-config', {
		method: 'PUT',
		headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify(patch)
	});
	const body = (await res.json().catch(() => null)) as
		| { config: AppConfig; ok?: boolean }
		| { error?: { message?: string } }
		| null;
	if (!res.ok) {
		const message =
			body && typeof body === 'object' && 'error' in body && body.error?.message
				? body.error.message
				: `Failed to save app config (${res.status})`;
		throw new Error(message);
	}
	return (body as { config: AppConfig }).config;
}
