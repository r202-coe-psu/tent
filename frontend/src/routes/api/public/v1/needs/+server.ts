import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

// T-60 / FR-017-14: needs board from MongoDB read model via FastAPI (BFF + Bearer)
export const GET: RequestHandler = async ({ fetch }) => {
	try {
		const res = await fetch(`${fastapiBaseUrl()}/public/v1/needs`, {
			headers: fastapiServiceHeaders()
		});
		if (!res.ok) {
			return json(
				{ success: false, error: 'NEEDS_UNAVAILABLE' },
				{ status: res.status >= 400 ? res.status : 502 }
			);
		}
		const body = (await res.json()) as {
			shelters?: Array<{ code: string; name: string; needs: unknown[] }>;
		};
		return json(body.shelters ?? []);
	} catch {
		return json({ success: false, error: 'NEEDS_UNAVAILABLE' }, { status: 503 });
	}
};
