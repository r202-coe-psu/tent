import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

export const GET: RequestHandler = async ({ params, setHeaders, fetch }) => {
	// Cache the response for 60 seconds on the client and CDN to mitigate N+1 query load
	setHeaders({
		'Cache-Control': 'public, max-age=60, s-maxage=60'
	});
	const { id } = params;

	try {
		const res = await fetch(`${fastapiBaseUrl()}/public/v1/shelters/${encodeURIComponent(id)}`, {
			headers: fastapiServiceHeaders()
		});

		if (res.ok) {
			const data = await res.json();
			return json(data);
		}
	} catch (e) {
		console.error('Error fetching shelter detail from FastAPI:', e);
	}

	return json({ error: 'Shelter not found' }, { status: 404 });
};
