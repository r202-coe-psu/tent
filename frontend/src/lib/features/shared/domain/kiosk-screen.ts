import { z } from 'zod';

/** The two kiosk screens: compact (ตู้เล็ก 1024×600) and portrait (ตู้ใหญ่ 1080×1920). */
export const kioskScreenTypeSchema = z.enum(['compact', 'portrait']);
export type KioskScreenType = z.infer<typeof kioskScreenTypeSchema>;

export const KIOSK_SCREEN_TYPES: readonly KioskScreenType[] = kioskScreenTypeSchema.options;

/** A doc stored before screen types existed reads as the compact kiosk. */
export const DEFAULT_KIOSK_SCREEN_TYPE: KioskScreenType = 'compact';

export const KIOSK_SCREENS: Record<
	KioskScreenType,
	{ label: string; size: string; width: number; height: number }
> = {
	compact: { label: 'ตู้เล็ก', size: '1024×600', width: 1024, height: 600 },
	portrait: { label: 'ตู้ใหญ่', size: '1080×1920', width: 1080, height: 1920 }
};

export function screenTypeOf(doc: { screen_type?: KioskScreenType | null }): KioskScreenType {
	return doc.screen_type ?? DEFAULT_KIOSK_SCREEN_TYPE;
}
