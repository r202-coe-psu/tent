import type { PageLoad } from './$types';
import type { FaqItem } from '$lib/features/public-portal';
import type { Announcement } from '$lib/features/announcements';

export const load: PageLoad = async ({ fetch }) => {
	let faqs: FaqItem[] = [];
	let announcements: Announcement[] = [];
	let configData: Record<string, unknown> = {};
	try {
		const configRes = await fetch('/api/public/v1/config/faqs');
		if (configRes.ok) {
			configData = await configRes.json();
			faqs = (configData.faqs as FaqItem[]) || [];
		}
	} catch (e) {
		console.error('Failed to fetch config', e);
	}

	try {
		const annRes = await fetch('/api/public/v1/announcements');
		if (annRes.ok) {
			const annData = await annRes.json();
			announcements = (annData.items as Announcement[]) || [];
		}
	} catch (e) {
		console.error('Failed to fetch announcements', e);
	}

	return {
		configData,
		announcements,
		faqs
	};
};
