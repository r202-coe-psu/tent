import { resolve } from '$app/paths';
import { redirect } from '@sveltejs/kit';
import {
	buildKioskContextQuery,
	fetchKioskHardware,
	readKioskDisplayQuery
} from '$lib/features/kiosk/config';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ url, fetch }) => {
	const hardware = await fetchKioskHardware(fetch);
	if (!hardware.qrCheckInEnabled) {
		const context = readKioskDisplayQuery(url.searchParams);
		redirect(307, `${resolve('/kiosk')}${buildKioskContextQuery(context)}`);
	}
};
