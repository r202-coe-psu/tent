/**
 * The few scanner-device fields a printer needs to link to a kiosk (FR-5a / FR-48). Structural on
 * purpose: the page hands over `useScannerDevices` data from the `kiosk-devices` barrel and this
 * feature never imports that feature.
 */
export interface KioskDeviceRef {
	device_id: string;
	name: string;
	shelter_code: string;
}

/** Scanners a printer of `shelterCode` may be linked to (the server rejects other shelters). */
export function kioskDevicesOfShelter<T extends KioskDeviceRef>(
	devices: readonly T[],
	shelterCode: string
): T[] {
	const code = shelterCode.toUpperCase();
	return devices.filter((device) => device.shelter_code.toUpperCase() === code);
}

/** Scanner name for a printer's `kiosk_device_id`; the id itself when unknown; null when unlinked. */
export function kioskLinkName(
	kioskDeviceId: string | null | undefined,
	devices: readonly KioskDeviceRef[]
): string | null {
	if (!kioskDeviceId) return null;
	return devices.find((device) => device.device_id === kioskDeviceId)?.name ?? kioskDeviceId;
}
