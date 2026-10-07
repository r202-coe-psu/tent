import type { LayoutLoad } from './$types';
import type { Announcement } from '$lib/features/announcements';
import type { FaqItem } from '$lib/features/public-portal';

export interface PublicLayoutConfig {
	phone_number?: string;
	line_oa_url?: string;
	facebook_url?: string;
}

type PublicLayoutConfigResponse = PublicLayoutConfig & { faqs?: FaqItem[] };

export const load = (async ({ fetch }) => {
	let announcements: Announcement[] = [];
	let configData: PublicLayoutConfig = {};
	let faqs: FaqItem[] = [];

	try {
		const [annRes, configRes] = await Promise.all([
			fetch('/api/public/v1/announcements'),
			fetch('/api/public/v1/config/faqs?category=public')
		]);
		const [annData, rawConfig] = await Promise.all([
			annRes.ok ? annRes.json() : null,
			configRes.ok ? configRes.json() : null
		]);

		if (annData) {
			announcements = (annData.items as Announcement[]) || [];
		}

		if (rawConfig) {
			const cfg = rawConfig as PublicLayoutConfigResponse;
			configData = {
				phone_number: cfg.phone_number || '',
				line_oa_url: cfg.line_oa_url || '',
				facebook_url: cfg.facebook_url || ''
			};
			faqs = cfg.faqs || [];
		}
	} catch (e) {
		console.error('Failed to fetch layout data', e);
	}

	return {
		announcements,
		configData,
		faqs
	};
}) satisfies LayoutLoad;
