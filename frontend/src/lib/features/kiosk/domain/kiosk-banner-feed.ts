import { z } from 'zod';

export const kioskBannerSlideSchema = z.object({
	id: z.string().min(1),
	title: z.string(),
	caption: z.string().nullable(),
	duration_sec: z.number().int().min(3).max(60),
	image_url: z.string().min(1)
});

export const kioskBannerFeedSchema = z.object({
	banners: z.array(kioskBannerSlideSchema),
	fetched_at: z.string()
});

export type KioskBannerSlide = z.infer<typeof kioskBannerSlideSchema>;
