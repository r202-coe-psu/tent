import type { LayoutLoad } from './$types';
import type { Announcement } from '$lib/features/announcements';

export interface PublicLayoutConfig {
	phone_number?: string;
	line_oa_url?: string;
	facebook_url?: string;
}

export const load = (async ({ fetch }) => {
	let announcements: Announcement[] = [];
	let configData: PublicLayoutConfig = {};

	try {
		const [annRes, configRes] = await Promise.all([
			fetch('/api/public/v1/announcements'),
			fetch('/api/public/v1/config/faqs?category=public')
		]);

		if (annRes.ok) {
			const data = await annRes.json();
			announcements = (data.items as Announcement[]) || [];
		}

		if (configRes.ok) {
			const cfg = await configRes.json();
			configData = {
				phone_number: cfg.phone_number || '',
				line_oa_url: cfg.line_oa_url || '',
				facebook_url: cfg.facebook_url || ''
			};
		}
	} catch (e) {
		console.error('Failed to fetch layout data', e);
	}

	return {
		announcements,
		configData
	};
}) satisfies LayoutLoad;
