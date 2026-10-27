import { kioskBannerFeedSchema, type KioskBannerSlide } from '../domain/kiosk-banner-feed';

export const KIOSK_BANNERS_TIMEOUT_MS = 3_000;

/** Fail soft (P8): any error, timeout, non-2xx or malformed body yields no slides, so the kiosk
 * home never shows an overlay it cannot render. Nothing is cached — the controller owns refresh. */
export async function fetchKioskBanners(
	fetchFn: typeof fetch = fetch
): Promise<KioskBannerSlide[]> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), KIOSK_BANNERS_TIMEOUT_MS);
	try {
		const response = await fetchFn('/api/v1/kiosk/banners', {
			method: 'POST',
			cache: 'no-store',
			signal: controller.signal
		});
		if (!response.ok) return [];
		const parsed = kioskBannerFeedSchema.safeParse(await response.json());
		return parsed.success ? parsed.data.banners : [];
	} catch {
		return [];
	} finally {
		clearTimeout(timer);
	}
}
