import { json } from '@sveltejs/kit';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ fetch }) => {
	try {
		const apiRes = await fetch(`${fastapiBaseUrl()}/public/v1/config/faqs`, {
			method: 'GET',
			headers: fastapiServiceHeaders()
		});

		if (apiRes.ok) {
			const data = await apiRes.json();
			return json(data, {
				headers: {
					'Cache-Control': 'public, max-age=60'
				}
			});
		}

		return json({ faqs: [] }, { status: apiRes.status });
	} catch (e) {
		console.error('Failed to fetch FAQs from backend', e);
		return json({ faqs: [] }, { status: 500 });
	}
};
