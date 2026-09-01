import type { PageLoad } from './$types';
import type { FaqItem } from '$lib/features/public-portal';
import type { Announcement } from '$lib/features/announcements';

type TransparencySummaryPayload = {
	summary?: {
		shelters_open: number;
		shelters_total: number;
		occupancy_total: number | null;
		vulnerable_count: number | null;
	};
	flags?: {
		public_metrics_occupancy: boolean;
		public_metrics_vulnerable: boolean;
		emergency_mode?: boolean;
	};
	lastUpdated?: number;
	isStale?: boolean;
};

export const load: PageLoad = async ({ fetch }) => {
	let faqs: FaqItem[] = [];
	let announcements: Announcement[] = [];
	let configData: Record<string, unknown> = {};
	let metrics: TransparencySummaryPayload | undefined;

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

	try {
		const summaryRes = await fetch('/api/public/v1/transparency/summary');
		const summaryData = (await summaryRes.json().catch(() => null)) as TransparencySummaryPayload | null;

		if (!summaryRes.ok) {
			console.error(
				'[public-home] transparency summary request failed',
				summaryRes.status,
				summaryData
			);
		}

		if (summaryData?.summary && summaryData.flags != null) {
			metrics = {
				summary: summaryData.summary,
				flags: summaryData.flags,
				lastUpdated: summaryData.lastUpdated ?? Date.now(),
				isStale: summaryData.isStale ?? !summaryRes.ok
			};
		} else if (!summaryData?.summary) {
			console.error('[public-home] transparency summary missing from response', summaryData);
		}
	} catch (e) {
		console.error('[public-home] failed to fetch transparency summary', e);
	}

	return {
		configData,
		announcements,
		faqs,
		...metrics
	};
};
