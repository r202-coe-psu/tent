import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
	// Mock GET /public/v1/transparency/summary
	const summary = {
		shelters_open: 5,
		shelters_total: 5,
		occupancy_total: 7
	};

	return {
		summary,
		// Mock initial timestamp (e.g. freshly fetched)
		lastUpdated: Date.now(),
		// kill-switch default on
		flags: {
			public_metrics_occupancy: true
		}
	};
};
