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

export type PublicNeedItem = {
	item_id: string;
	name: string;
	qty_needed: string | number;
	qty_target?: string | number;
	unit: string;
	status?: string;
	category?: string;
	urgency?: 'critical' | 'important' | 'normal' | string;
	target?: number;
	received?: number;
};

export type PublicShelterNeeds = {
	code: string;
	name: string;
	needs: PublicNeedItem[];
};

export type PublicShelterItem = {
	code: string;
	name: string;
	province?: string;
	district?: string;
	subdistrict?: string;
	site_kind?: string;
	status?: string;
	capacity?: number;
};

export const load: PageLoad = async ({ fetch }) => {
	let faqs: FaqItem[] = [];
	let announcements: Announcement[] = [];
	let configData: Record<string, unknown> = {};
	let metrics: TransparencySummaryPayload | undefined;
	let donationNeeds: PublicShelterNeeds[] = [];
	let sheltersList: PublicShelterItem[] = [];

	try {
		const configRes = await fetch('/api/public/v1/config/faqs?category=public');
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
		const [needsRes, sheltersRes] = await Promise.all([
			fetch('/api/public/v1/needs').catch(() => null),
			fetch('/api/public/v1/shelters').catch(() => null)
		]);
		if (needsRes?.ok) {
			donationNeeds = (await needsRes.json().catch(() => [])) || [];
		}
		if (sheltersRes?.ok) {
			const sBody = (await sheltersRes.json().catch(() => ({}))) as {
				shelters?: PublicShelterItem[];
			};
			sheltersList = sBody.shelters || [];
		}
	} catch (e) {
		console.error('[public-home] failed to fetch donation needs/shelters', e);
	}

	try {
		const summaryRes = await fetch('/api/public/v1/transparency/summary');
		const summaryData = (await summaryRes
			.json()
			.catch(() => null)) as TransparencySummaryPayload | null;

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
		donationNeeds,
		sheltersList,
		...metrics
	};
};
