import { resolve } from '$app/paths';
import { redirect } from '@sveltejs/kit';
import {
	buildKioskContextQuery,
	getKioskDisplayContext,
	readKioskDisplayQuery
} from '$lib/features/kiosk';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
	const context = getKioskDisplayContext(readKioskDisplayQuery(url.searchParams));
	if (!context.phoneCheckInEnabled) {
		redirect(307, `${resolve('/kiosk')}${buildKioskContextQuery(context)}`);
	}
};
