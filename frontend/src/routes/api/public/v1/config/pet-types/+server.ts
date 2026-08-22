import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readEffectiveMasterDoc } from '$lib/server/master-data-server';

export const prerender = false;

/**
 * GET /api/public/v1/config/pet-types?shelter=<code> — code/label/default for
 * the pet species a shelter accepts on a booking.
 *
 * Unlike vulnerable groups, `pet_types` is a per-shelter master data type
 * (global list plus each shelter's own local items and `disabled_global_codes`
 * overrides — CR-049): a shelter may accept species the global list does not
 * offer, or disable one the global list normally allows. `readEffectiveMasterDoc`
 * resolves the merge, so the choices shown to the citizen always match what the
 * chosen shelter actually configured. `shelter` is optional — omitting it (or a
 * shelter with no local doc) falls back to the global list only.
 *
 * Reference data with no PII: cacheable, and degrades to an empty list rather
 * than failing the form (a booking with no pet species offered still lets the
 * citizen type notes; the section simply cannot be completed until it loads).
 */
export const GET: RequestHandler = async ({ url }) => {
	const shelterCode = url.searchParams.get('shelter')?.trim() || null;
	try {
		const doc = await readEffectiveMasterDoc('pet_types', shelterCode);
		const petTypes = (doc?.items ?? [])
			.filter((item) => item.status !== 'inactive')
			.map((item) => ({ code: item.code, label: item.label, is_default: item.is_default }));

		return json({ petTypes }, { headers: { 'Cache-Control': 'public, max-age=300' } });
	} catch (e) {
		console.warn('pet-types lookup failed:', e);
		return json({ petTypes: [] }, { headers: { 'Cache-Control': 'no-store' } });
	}
};
