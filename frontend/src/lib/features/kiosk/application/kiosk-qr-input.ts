import { fetchKioskHardware } from '../data/kiosk-hardware.api';
import type { KioskHardware } from '../domain/kiosk-hardware';

/** This machine's QR input setup, as reported by its scanner client (camera default). */
export function loadKioskHardware(): Promise<KioskHardware> {
	return fetchKioskHardware();
}
