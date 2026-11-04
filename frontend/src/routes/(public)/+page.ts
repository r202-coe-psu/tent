import type { PageLoad } from './$types';

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
	/** One row per item + drop-off point (CR-206 A2): `item_id` can repeat in a shelter. */
	drop_off_point_id?: string | null;
	drop_off_point_name?: string | null;
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

export const load: PageLoad = async ({ fetch, parent }) => {
	let metrics: TransparencySummaryPayload | undefined;

	const [, needsRes, sheltersRes, summaryRes] = await Promise.all([
		parent(),
		fetch('/api/public/v1/needs').catch(() => null),
		fetch('/api/public/v1/shelters').catch(() => null),
		fetch('/api/public/v1/transparency/summary').catch((e) => {
			console.error('[public-home] failed to fetch transparency summary', e);
			return null;
		})
	]);
	// `null` = the list could not be read (network error, non-2xx, or a body that is not JSON).
	const [needsData, sheltersData, summaryData] = await Promise.all([
		needsRes?.ok
			? (needsRes.json().catch(() => null) as Promise<PublicShelterNeeds[] | null>)
			: Promise.resolve(null),
		sheltersRes?.ok
			? (sheltersRes.json().catch(() => null) as Promise<{
					shelters?: PublicShelterItem[];
				} | null>)
			: Promise.resolve(null),
		summaryRes ? summaryRes.json().catch(() => null) : Promise.resolve(null)
	]);

	const donationNeeds: PublicShelterNeeds[] = needsData || [];
	const sheltersList: PublicShelterItem[] = sheltersData?.shelters || [];
	/**
	 * Either list failed to load (#740). The page still renders with empty lists, but says the
	 * system is unavailable — otherwise an outage reads as "no needs / no shelters".
	 */
	const listsLoadFailed = needsData === null || sheltersData === null;

	if (summaryRes) {
		const parsedSummaryData = summaryData as TransparencySummaryPayload | null;

		if (!summaryRes.ok) {
			console.error(
				'[public-home] transparency summary request failed',
				summaryRes.status,
				parsedSummaryData
			);
		}

		if (parsedSummaryData?.summary && parsedSummaryData.flags != null) {
			metrics = {
				summary: parsedSummaryData.summary,
				flags: parsedSummaryData.flags,
				lastUpdated: parsedSummaryData.lastUpdated ?? Date.now(),
				isStale: parsedSummaryData.isStale ?? !summaryRes.ok
			};
		} else if (!parsedSummaryData?.summary) {
			console.error('[public-home] transparency summary missing from response', parsedSummaryData);
		}
	}

	return {
		donationNeeds,
		sheltersList,
		listsLoadFailed,
		...metrics
	};
};
