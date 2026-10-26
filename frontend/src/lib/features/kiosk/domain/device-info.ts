import { z } from 'zod';
import { kioskScreenTypeSchema, type KioskScreenType } from '$lib/features/shared';

/** Wire body of a 200 from `POST /api/v1/kiosk/device-info`. */
export const kioskDeviceInfoSchema = z.object({
	device: z.object({
		device_id: z.string(),
		name: z.string(),
		station_name: z.string(),
		screen_type: kioskScreenTypeSchema
	}),
	shelter: z.object({ code: z.string(), name: z.string() }),
	staff_pin: z.object({ is_default: z.boolean(), updated_at: z.string().nullable() }),
	banner_group: z.object({ id: z.string(), name: z.string() }).nullable()
});

/** What the staff device-info panel shows about this kiosk. */
export type KioskDeviceInfo = {
	deviceId: string;
	name: string;
	stationName: string;
	screenType: KioskScreenType;
	shelterCode: string;
	shelterName: string;
	/** Always set: the panel only opens after the PIN matched. */
	staffPin: { isDefault: boolean; updatedAt: string | null };
	bannerGroup: { id: string; name: string } | null;
};

/** Answer of the kiosk machine about itself; empty when it cannot say (plain browser, error). */
export type KioskHostInfo = { hostname: string | null; ips: string[] };

export function toKioskDeviceInfo(wire: z.infer<typeof kioskDeviceInfoSchema>): KioskDeviceInfo {
	return {
		deviceId: wire.device.device_id,
		name: wire.device.name,
		stationName: wire.device.station_name,
		screenType: wire.device.screen_type,
		shelterCode: wire.shelter.code,
		shelterName: wire.shelter.name,
		staffPin: { isDefault: wire.staff_pin.is_default, updatedAt: wire.staff_pin.updated_at },
		bannerGroup: wire.banner_group
	};
}
