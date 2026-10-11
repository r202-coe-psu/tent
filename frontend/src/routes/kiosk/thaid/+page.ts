import { resolve } from '$app/paths';
import { redirect } from '@sveltejs/kit';
import {
	buildKioskContextQuery,
	fetchKioskConfig,
	getKioskDisplayContext,
	readKioskDisplayQuery
} from '$lib/features/kiosk/config';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ url, fetch }) => {
	const config = await fetchKioskConfig(fetch);
	if (!config.thaidCheckInEnabled) {
		const context = getKioskDisplayContext(readKioskDisplayQuery(url.searchParams));
		redirect(307, `${resolve('/kiosk')}${buildKioskContextQuery(context)}`);
	}
};
