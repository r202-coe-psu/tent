import { json } from '@sveltejs/kit';
import { adminRaw } from '$lib/server/couch-admin';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';
import type { RequestHandler } from './$types';
import type { FaqItem } from '$lib/features/public-portal';

const CONFIG_DOC_PATH = '/registry/config:public_portal';

export const GET: RequestHandler = async ({ url, fetch }) => {
	const category = url.searchParams.get('category') || 'public';

	// 1. Try CouchDB directly (canonical operational store for public-portal-config)
	try {
		const { status, data } = await adminRaw(CONFIG_DOC_PATH, 'GET');
		if (status === 200 && data) {
			const config = data as {
				faqs?: Record<string, FaqItem[]> | FaqItem[];
				line_oa_url?: string;
				facebook_url?: string;
				phone_number?: string;
			};

			let rawItems: FaqItem[] = [];
			if (Array.isArray(config.faqs)) {
				rawItems = config.faqs;
			} else if (config.faqs && typeof config.faqs === 'object') {
				rawItems = config.faqs[category] || [];
			}

			const faqs = rawItems
				.filter((item) => item && item.is_published !== false)
				.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

			return json(
				{
					faqs,
					line_oa_url: config.line_oa_url || '',
					facebook_url: config.facebook_url || '',
					phone_number: config.phone_number || ''
				},
				{
					headers: {
						'Cache-Control': 'no-cache, no-store, must-revalidate'
					}
				}
			);
		}
	} catch (e) {
		console.warn('Failed to fetch config from CouchDB, trying FastAPI fallback', e);
	}

	// 2. Fallback to FastAPI if CouchDB document doesn't exist or is unavailable
	try {
		const apiRes = await fetch(`${fastapiBaseUrl()}/public/v1/config/faqs`, {
			method: 'GET',
			headers: fastapiServiceHeaders()
		});

		if (apiRes.ok) {
			const data = await apiRes.json();
			return json(data, {
				headers: {
					'Cache-Control': 'no-cache, no-store, must-revalidate'
				}
			});
		}

		return json({ faqs: [] }, { status: apiRes.status });
	} catch (e) {
		console.error('Failed to fetch FAQs from backend', e);
		return json({ faqs: [] }, { status: 500 });
	}
};
