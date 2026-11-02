import type { LayoutLoad } from './$types';
import type { Announcement } from '$lib/features/announcements';
import type { FaqItem, PublicFooterLogo } from '$lib/features/public-portal';

export interface PublicLayoutConfig {
	phone_number?: string;
	line_oa_url?: string;
	facebook_url?: string;
	footer_logos?: PublicFooterLogo[];
}

type PublicLayoutConfigResponse = PublicLayoutConfig & { faqs?: FaqItem[] };

/**
 * SvelteKit (ssr = false) mounts no public route until this load settles, so a hung BFF call
 * would blank every public page. Keep above the BFF's own upstream bounds (announcements 3s,
 * faqs 2s + 2s) so the BFF answers first; past this we render without announcements/FAQs.
 */
const PUBLIC_LAYOUT_FETCH_TIMEOUT_MS = 5_000;

type LayoutFetch = Parameters<LayoutLoad>[0]['fetch'];

/** JSON body of `url`, or null on non-OK / timeout / network failure (never throws). */
async function fetchJsonOrNull<T>(fetch: LayoutFetch, url: string): Promise<T | null> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(PUBLIC_LAYOUT_FETCH_TIMEOUT_MS) });
		return res.ok ? ((await res.json()) as T) : null;
	} catch (e) {
		console.error('Failed to fetch layout data', url, e);
		return null;
	}
}

export const load = (async ({ fetch }) => {
	let announcements: Announcement[] = [];
	let configData: PublicLayoutConfig = {};
	let faqs: FaqItem[] = [];

	const [annData, rawConfig] = await Promise.all([
		fetchJsonOrNull<{ items?: Announcement[] }>(fetch, '/api/public/v1/announcements'),
		fetchJsonOrNull<PublicLayoutConfigResponse>(fetch, '/api/public/v1/config/faqs?category=public')
	]);

	if (annData) {
		announcements = annData.items || [];
	}

	if (rawConfig) {
		configData = {
			phone_number: rawConfig.phone_number || '',
			line_oa_url: rawConfig.line_oa_url || '',
			facebook_url: rawConfig.facebook_url || '',
			footer_logos: rawConfig.footer_logos || []
		};
		faqs = rawConfig.faqs || [];
	}

	return {
		announcements,
		configData,
		faqs
	};
}) satisfies LayoutLoad;
