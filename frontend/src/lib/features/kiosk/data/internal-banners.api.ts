import { kioskBannerFeedSchema, type KioskBannerSlide } from '../domain/kiosk-banner-feed';

export const INTERNAL_BANNERS_TIMEOUT_MS = 3_000;

export type InternalBannersResult =
	{ kind: 'ok'; slides: KioskBannerSlide[] } | { kind: 'not_found' } | { kind: 'error' };

export async function fetchInternalBanners(
	shelter: string,
	code: string,
	fetchFn: typeof fetch = fetch
): Promise<InternalBannersResult> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), INTERNAL_BANNERS_TIMEOUT_MS);
	try {
		const response = await fetchFn(
			`/api/v1/kiosk/internal/${encodeURIComponent(shelter)}/banners?c=${encodeURIComponent(code)}`,
			{ method: 'GET', cache: 'no-store', signal: controller.signal }
		);
		if (response.status === 404) return { kind: 'not_found' };
		if (!response.ok) return { kind: 'error' };
		const parsed = kioskBannerFeedSchema.safeParse(await response.json());
		return parsed.success ? { kind: 'ok', slides: parsed.data.banners } : { kind: 'error' };
	} catch {
		return { kind: 'error' };
	} finally {
		clearTimeout(timer);
	}
}
