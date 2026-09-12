import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readEffectiveMasterDoc } from '$lib/server/master-data-server';

export const prerender = false;

/**
 * GET /api/public/v1/config/volunteer-skills?shelter=<code>
 * Returns active volunteer skills from Master Data for public registration & job application forms.
 */
export const GET: RequestHandler = async ({ url }) => {
	const shelterCode = url.searchParams.get('shelter')?.trim() || null;
	try {
		const doc = await readEffectiveMasterDoc('volunteer_skills', shelterCode);
		const volunteerSkills = (doc?.items ?? [])
			.filter((item) => item.status !== 'inactive')
			.map((item) => ({
				code: item.code,
				label: item.label,
				category: item.category ?? 'operational',
				description: item.description ?? '',
				is_default: item.is_default ?? false
			}));

		return json({ volunteerSkills }, { headers: { 'Cache-Control': 'public, max-age=300' } });
	} catch (e) {
		console.warn('volunteer-skills lookup failed:', e);
		return json({ volunteerSkills: [] }, { headers: { 'Cache-Control': 'no-store' } });
	}
};
