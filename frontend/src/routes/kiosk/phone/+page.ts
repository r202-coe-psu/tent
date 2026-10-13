import { resolve } from '$app/paths';
import { redirect } from '@sveltejs/kit';
import {
	buildKioskContextQuery,
	getKioskDisplayContext,
	readKioskDisplayQuery
} from '$lib/features/kiosk/config';
import type { PageLoad } from './$types';

/** The phone check-in is gone; old links and bookmarks land on the QR reprint page instead. */
export const load: PageLoad = ({ url }) => {
	const context = getKioskDisplayContext(readKioskDisplayQuery(url.searchParams));
	redirect(307, `${resolve('/kiosk/reprint')}${buildKioskContextQuery(context)}`);
};
