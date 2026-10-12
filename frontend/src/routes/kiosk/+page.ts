import { fetchKioskConfig, fetchKioskHardware } from '$lib/features/kiosk/config';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const [config, hardware] = await Promise.all([
		fetchKioskConfig(fetch),
		fetchKioskHardware(fetch)
	]);
	return { ...config, qrCheckInEnabled: hardware.qrCheckInEnabled };
};
