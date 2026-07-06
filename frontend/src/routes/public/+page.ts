import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	try {
		const response = await fetch('/api/public/v1/transparency/summary');
		if (response.ok) {
			const data = await response.json();
			return data;
		}
	} catch (e) {
		console.error('Failed to fetch summary metrics', e);
	}

	// Fallback mock data if API fails
	return {
		summary: {
			shelters_open: 5,
			shelters_total: 5,
			occupancy_total: 7
		},
		lastUpdated: Date.now(),
		isStale: false,
		flags: {
			public_metrics_occupancy: true,
			public_metrics_vulnerable: true,
			public_metrics_volunteers: false
		}
	};
};
