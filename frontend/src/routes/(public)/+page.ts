import type { PageLoad } from './$types';
import type { FaqItem } from '$lib/features/public-portal';
import type { Announcement } from '$lib/features/announcements';

export const load: PageLoad = async ({ fetch }) => {
	let faqs: FaqItem[] = [];
	let announcements: Announcement[] = [];
	try {
		const configRes = await fetch('/api/public/v1/config/faqs');
		if (configRes.ok) {
			const configData = await configRes.json();
			faqs = configData.faqs || [];
		}
	} catch (e) {
		console.error('Failed to fetch config', e);
	}

	try {
		const annRes = await fetch('/api/public/v1/announcements');
		if (annRes.ok) {
			const annData = await annRes.json();
			announcements = annData.items || [];
		}
	} catch (e) {
		console.error('Failed to fetch announcements', e);
	}

	try {
		const response = await fetch('/api/public/v1/transparency/summary');
		if (response.ok) {
			const data = await response.json();
			return { ...data, faqs, announcements };
		}
	} catch (e) {
		console.error('Failed to fetch summary metrics', e);
	}

	// Fallback mock data if API fails
	return {
		summary: {
			shelters_open: 0,
			shelters_total: 0,
			occupancy_total: null,
			vulnerable_count: null
		},
		lastUpdated: Date.now(),
		isStale: true,
		flags: {
			public_metrics_occupancy: true,
			public_metrics_vulnerable: true,
			public_metrics_volunteers: false,
			emergency_mode: false
		},
		isError: true,
		faqs,
		announcements
	};
};
