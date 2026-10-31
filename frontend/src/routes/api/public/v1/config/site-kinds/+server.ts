import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readMasterDoc } from '$lib/server/master-data-server';

export const prerender = false;

/**
 * GET /api/public/v1/config/site-kinds — code → label for shelter `site_kind`.
 *
 * Public shelters carry the raw `master_data:site_kind` code (CR-198 FR-15);
 * `master_data` is not projected into Mongo, so labels come from here. Unlike
 * shelter-types this returns every item, `inactive` included: a shelter saved
 * with a since-disabled code must still resolve its label. The client decides
 * which items are selectable (active only) in the filter.
 *
 * Reference data with no PII: cacheable, and degrades to an empty list rather
 * than failing the page.
 */
export const GET: RequestHandler = async () => {
	try {
		const doc = await readMasterDoc('site_kind');
		const types = (doc?.items ?? []).map((item) => ({
			code: item.code,
			label_th: item.label_th,
			label_en: item.label_en,
			status: item.status
		}));

		return json({ types }, { headers: { 'Cache-Control': 'public, max-age=300' } });
	} catch (e) {
		console.warn('site-kinds lookup failed:', e);
		return json({ types: [] }, { headers: { 'Cache-Control': 'no-store' } });
	}
};
