import { json } from '@sveltejs/kit';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ fetch }) => {
	try {
		const apiRes = await fetch(`${fastapiBaseUrl()}/public/v1/announcements`, {
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

		return json(
			{ items: [], total: 0, page: 1, size: 20, total_pages: 0 },
			{ status: apiRes.status }
		);
	} catch (e) {
		console.error('Failed to fetch announcements from backend', e);
		return json({ items: [], total: 0, page: 1, size: 20, total_pages: 0 }, { status: 500 });
	}
};
