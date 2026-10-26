import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { portalCredentialSchema } from '$lib/features/volunteer-portal/server';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

export const prerender = false;

/**
 * The signed-in volunteer's own profile (Access Portal edit screen).
 *
 * Never cached — staff edit the same profile from the back office, and a cached copy
 * would show a name or a verification badge the shelter has already changed.
 */
export const POST: RequestHandler = async ({ request, fetch }) => {
	const body: unknown = await request.json().catch(() => null);
	const parsed = portalCredentialSchema.safeParse(body);
	try {
		if (!parsed.success) {
			return json({ success: false, error: 'INVALID_INPUT' }, { status: 422 });
		}
		const res = await fetch(`${fastapiBaseUrl()}/public/v1/volunteer/profile`, {
			method: 'POST',
			headers: fastapiServiceHeaders({ 'Content-Type': 'application/json' }),
			body: JSON.stringify(parsed.data)
		});
		if (!res.ok) {
			return json({ success: false, error: 'PROFILE_UNAVAILABLE' }, { status: 502 });
		}
		return json(await res.json(), { headers: { 'Cache-Control': 'no-store' } });
	} catch {
		return json({ success: false, error: 'PROFILE_UNAVAILABLE' }, { status: 503 });
	}
};
