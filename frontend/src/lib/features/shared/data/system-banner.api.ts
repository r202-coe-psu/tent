import type { SystemBanner } from '../domain/app-config';

export async function fetchSystemBanner(fetchFn: typeof fetch = fetch): Promise<SystemBanner> {
	const res = await fetchFn('/api/public/v1/system-banner', {
		headers: { Accept: 'application/json' }
	});
	if (!res.ok) throw new Error(`Failed to load system banner (${res.status})`);
	return (await res.json()) as SystemBanner;
}
