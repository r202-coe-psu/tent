import type { SetupStep, ShelterVerifyResult } from './shelter.seed';

/**
 * Client wrappers for the privileged shelter setup endpoint. The browser only
 * triggers actions with its session cookie — admin credentials live solely on
 * the server (see /api/admin/shelter).
 */
async function action<T>(action: 'setup' | 'teardown' | 'verify'): Promise<T> {
	const res = await fetch('/api/admin/shelter', {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action })
	});
	const data = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
	if (!res.ok) {
		throw new Error(
			(data as { message?: string } | null)?.message ?? `Shelter ${action} failed (${res.status})`
		);
	}
	return data as T;
}

export const setupShelters = () => action<SetupStep[]>('setup');
export const teardownShelters = () => action<SetupStep[]>('teardown');
export const verifyShelters = () => action<ShelterVerifyResult>('verify');
