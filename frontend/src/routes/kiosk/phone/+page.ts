import { resolve } from '$app/paths';
import { redirect } from '@sveltejs/kit';
import { fetchKioskConfig } from '$lib/features/kiosk';
import {
	buildKioskContextQuery,
	getKioskDisplayContext,
	readKioskDisplayQuery
} from '$lib/features/kiosk';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ url, fetch }) => {
	const config = await fetchKioskConfig(fetch);
	if (!config.phoneCheckInEnabled) {
		const context = getKioskDisplayContext(readKioskDisplayQuery(url.searchParams));
		redirect(307, `${resolve('/kiosk')}${buildKioskContextQuery(context)}`);
	}
};
