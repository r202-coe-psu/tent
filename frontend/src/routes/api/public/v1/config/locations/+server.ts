import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listDistricts, listProvinces, listSubdistricts } from '$lib/server/thailand-location';

export const prerender = false;

/**
 * GET /api/public/v1/config/locations — Thailand province → district → subdistrict
 * lookup for the public booking form's domicile address (CR-105).
 *
 * The staff plane already serves this from `/api/v1/thailand-location/*`, but the
 * public SPA must not call the service plane (`serviceFetch` sends the staff
 * session cookie and the public form has none) — so the same server helper is
 * re-exposed on the public prefix. One handler, three shapes, chosen by how much
 * of the cascade the caller has filled in:
 *
 *   (no query)                  → { provinces: string[] }
 *   ?province=X                 → { districts: string[] }
 *   ?province=X&district=Y      → { subdistricts: [{ subdistrict, zipcode }] }
 *
 * Reference data with no PII and no CouchDB read (the helper reads a bundled
 * JSON snapshot), so it is long-cacheable and degrades to an empty list rather
 * than failing the form.
 */
export const GET: RequestHandler = async ({ url }) => {
	const province = url.searchParams.get('province')?.trim() ?? '';
	const district = url.searchParams.get('district')?.trim() ?? '';
	const headers = { 'Cache-Control': 'public, max-age=86400' };

	try {
		if (province && district) {
			return json({ subdistricts: await listSubdistricts(province, district) }, { headers });
		}
		if (province) {
			return json({ districts: await listDistricts(province) }, { headers });
		}
		return json({ provinces: await listProvinces() }, { headers });
	} catch (e) {
		console.warn('public location lookup failed:', e);
		return json(
			{ provinces: [], districts: [], subdistricts: [] },
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	}
};
