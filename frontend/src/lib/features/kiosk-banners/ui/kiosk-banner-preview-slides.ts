import type { KioskBannerSlide } from '$lib/features/kiosk';
import { KIOSK_BANNER_LIMITS, isActiveAt, sortBanners } from '../domain/kiosk-banner';
import { screenTypeOf, type KioskScreenType } from '$lib/features/shared/domain/kiosk-screen';
import type { KioskBannerSummary } from '../data/kiosk-banner.repository';

type ListBanner = Pick<
	KioskBannerSummary,
	| '_id'
	| '_rev'
	| 'title'
	| 'caption'
	| 'order'
	| 'duration_sec'
	| 'start_at'
	| 'end_at'
	| 'status'
	| 'screen_type'
	| 'group_id'
>;

/**
 * Slides for the list page's「ดูตัวอย่างบน kiosk」: only banners active at `now`, in the order the
 * kiosk plays them (FR-KBN-29), grouped by the screen type each kiosk is served. With `groupId`,
 * only that banner group's banners are included.
 */
export function buildListPreviewSlides(
	banners: readonly ListBanner[],
	now: Date,
	imageUrl: (id: string, rev?: string) => string,
	groupId?: string
): Record<KioskScreenType, KioskBannerSlide[]> {
	const grouped: Record<KioskScreenType, KioskBannerSlide[]> = { compact: [], portrait: [] };
	for (const banner of sortBanners(
		banners.filter((b) => isActiveAt(b, now) && (groupId === undefined || b.group_id === groupId))
	)) {
		grouped[screenTypeOf(banner)].push({
			id: banner._id,
			title: banner.title,
			caption: banner.caption ?? null,
			duration_sec: banner.duration_sec,
			image_url: imageUrl(banner._id, banner._rev)
		});
	}
	return grouped;
}

type FormPreviewFields = { title: string; caption: string; duration_sec: number };

/** The banner being edited as one slide (unsaved image allowed); `null` while there is no image. */
export function buildFormPreviewSlide(
	values: FormPreviewFields,
	imageUrl: string | null
): KioskBannerSlide | null {
	if (!imageUrl) return null;
	const seconds = values.duration_sec;
	const validDuration =
		Number.isInteger(seconds) &&
		seconds >= KIOSK_BANNER_LIMITS.durationMin &&
		seconds <= KIOSK_BANNER_LIMITS.durationMax;
	const caption = values.caption.trim();
	return {
		id: 'preview',
		title: values.title.trim() || 'ตัวอย่างแบนเนอร์',
		caption: caption === '' ? null : caption,
		duration_sec: validDuration ? seconds : KIOSK_BANNER_LIMITS.durationDefault,
		image_url: imageUrl
	};
}
