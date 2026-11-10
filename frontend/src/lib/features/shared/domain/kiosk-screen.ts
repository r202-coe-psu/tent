import { z } from 'zod';

/**
 * Banner screen types: the two kiosk screens, compact (ตู้เล็ก 1024×600) and portrait (ตู้ใหญ่
 * 1080×1920), plus the TV (จอ TV 1920×1080), which is not a kiosk device.
 */
export const kioskScreenTypeSchema = z.enum(['compact', 'portrait', 'tv']);
export type KioskScreenType = z.infer<typeof kioskScreenTypeSchema>;

/** Screen types a kiosk device can drive; the TV is a banner screen only, never a device. */
export const kioskDeviceScreenTypeSchema = z.enum(['compact', 'portrait']);
export type KioskDeviceScreenType = z.infer<typeof kioskDeviceScreenTypeSchema>;

export const KIOSK_SCREEN_TYPES: readonly KioskScreenType[] = kioskScreenTypeSchema.options;

/** A doc stored before screen types existed reads as the compact kiosk. */
export const DEFAULT_KIOSK_SCREEN_TYPE = 'compact' satisfies KioskDeviceScreenType;

export const KIOSK_SCREENS: Record<
	KioskScreenType,
	{ label: string; size: string; width: number; height: number }
> = {
	compact: { label: 'ตู้เล็ก', size: '1024×600', width: 1024, height: 600 },
	portrait: { label: 'ตู้ใหญ่', size: '1080×1920', width: 1080, height: 1920 },
	tv: { label: 'จอ TV', size: '1920×1080', width: 1920, height: 1080 }
};

export function screenTypeOf<T extends KioskScreenType>(doc: {
	screen_type?: T | null;
}): T | typeof DEFAULT_KIOSK_SCREEN_TYPE {
	return doc.screen_type ?? DEFAULT_KIOSK_SCREEN_TYPE;
}
