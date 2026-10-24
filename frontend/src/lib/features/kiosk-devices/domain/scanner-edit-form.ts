import { z } from 'zod';
import { kioskScreenTypeSchema } from '$lib/features/shared/domain/kiosk-screen';
import {
	deviceStatusSchema,
	scannerDeviceInputSchema,
	type ScannerDevicePatch,
	type ScannerDeviceSummary
} from './scanner.schema';

/** The back-office "จัดการเครื่อง" dialog: the fields `PATCH /api/v1/kiosk/devices/[id]` accepts. */
export const scannerEditFormSchema = z.object({
	name: scannerDeviceInputSchema.shape.name,
	station_name: z.string().trim().min(1, 'กรุณาระบุจุดบริการ'),
	status: deviceStatusSchema,
	screen_type: kioskScreenTypeSchema
});
export type ScannerEditFormValues = z.infer<typeof scannerEditFormSchema>;

export function scannerEditFormValues(device: ScannerDeviceSummary): ScannerEditFormValues {
	return {
		name: device.name,
		station_name: device.station_name,
		status: device.status,
		screen_type: device.screen_type
	};
}

/** Only the fields that differ from `device` (text trimmed); `null` when there is nothing to save. */
export function scannerEditPatch(
	device: ScannerDeviceSummary,
	values: ScannerEditFormValues
): ScannerDevicePatch | null {
	const patch: ScannerDevicePatch = {};
	const name = values.name.trim();
	const station = values.station_name.trim();
	if (name !== device.name) patch.name = name;
	if (station !== device.station_name) patch.station_name = station;
	if (values.status !== device.status) patch.status = values.status;
	if (values.screen_type !== device.screen_type) patch.screen_type = values.screen_type;
	return Object.keys(patch).length > 0 ? patch : null;
}
