import { describe, expect, it } from 'vitest';
import { KIOSK_SCREENS, kioskScreenTypeSchema, screenTypeOf } from './kiosk-screen';

describe('screenTypeOf', () => {
	it('reads a device or banner stored before screen types as the compact kiosk', () => {
		expect(screenTypeOf({})).toBe('compact');
		expect(screenTypeOf({ screen_type: undefined })).toBe('compact');
	});

	it('keeps a stored screen type', () => {
		expect(screenTypeOf({ screen_type: 'portrait' })).toBe('portrait');
	});
});

describe('kioskScreenTypeSchema', () => {
	it('accepts the two kiosk screens and the TV screen only', () => {
		expect(kioskScreenTypeSchema.safeParse('compact').success).toBe(true);
		expect(kioskScreenTypeSchema.safeParse('portrait').success).toBe(true);
		expect(kioskScreenTypeSchema.safeParse('tv').success).toBe(true);
		expect(kioskScreenTypeSchema.safeParse('landscape').success).toBe(false);
	});
});

describe('KIOSK_SCREENS', () => {
	it('are the compact 1024×600 and portrait 1080×1920 kiosks', () => {
		expect(KIOSK_SCREENS.compact).toMatchObject({ label: 'ตู้เล็ก', width: 1024, height: 600 });
		expect(KIOSK_SCREENS.portrait).toMatchObject({ label: 'ตู้ใหญ่', width: 1080, height: 1920 });
	});

	it('has the TV screen sized 1920×1080 labelled จอ TV', () => {
		expect(KIOSK_SCREENS.tv).toMatchObject({ label: 'จอ TV', width: 1920, height: 1080 });
	});
});
