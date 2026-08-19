import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

/** GET /api/public/v1/shelters/[id] → FastAPI (Bearer EXTERNAL_API_SECRET). */
export const GET: RequestHandler = async ({ params, fetch, setHeaders }) => {
	setHeaders({
		'Cache-Control': 'public, max-age=60, s-maxage=60'
	});
	const { id } = params;

	try {
		const res = await fetch(`${fastapiBaseUrl()}/public/v1/shelters/${encodeURIComponent(id)}`, {
			headers: fastapiServiceHeaders()
		});
		if (res.ok) {
			return json(await res.json());
		}
		const payload = await res.json().catch(() => ({ error: 'Shelter not found' }));
		return json(payload, { status: res.status >= 400 ? res.status : 404 });
	} catch {
		return json({ error: 'Shelter not found' }, { status: 503 });
	}
};
