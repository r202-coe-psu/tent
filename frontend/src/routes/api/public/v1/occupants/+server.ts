import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

/** POST /api/public/v1/occupants → FastAPI (Bearer EXTERNAL_API_SECRET). */
export const POST: RequestHandler = async ({ request, fetch }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json(
			{ error: { code: 'INVALID_BODY', message: 'Request body must be JSON' } },
			{ status: 400 }
		);
	}

	try {
		const res = await fetch(`${fastapiBaseUrl()}/public/v1/occupants`, {
			method: 'POST',
			headers: fastapiServiceHeaders({ 'Content-Type': 'application/json' }),
			body: JSON.stringify(body)
		});
		const payload = await res.json().catch(() => ({}));
		return json(payload, { status: res.status, headers: { 'Cache-Control': 'no-store' } });
	} catch {
		return json(
			{
				error: { code: 'SEARCH_UNAVAILABLE', message: 'Occupants search temporarily unavailable' }
			},
			{ status: 503 }
		);
	}
};
