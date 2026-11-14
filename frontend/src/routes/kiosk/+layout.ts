import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import {
	buildKioskContextQuery,
	isKioskHomePath,
	kioskLanguageSession,
	KIOSK_CLOSED_PATH,
	KIOSK_LANGUAGE_PATH,
	readKioskDisplayQuery,
	readKioskServiceGate
} from '$lib/features/kiosk';
import type { LayoutLoad } from './$types';

/**
 * Closure first (#1302): a kiosk an admin has closed shows only the closed page, whatever the path
 * or the language state. A good read is cached for 30 s and a failed one for 15 s, so asking on every
 * navigation stays cheap even on a flaky link, and an unreadable config keeps the kiosk open (the
 * server answers 403 KIOSK_CLOSED on work endpoints).
 *
 * Then a fresh kiosk boot lands on the language picker before the method page. `ssr = false`, so
 * this runs in the browser once per page load; the in-memory session then remembers the choice.
 */
export const load: LayoutLoad = async ({ url, fetch }) => {
	if (url.pathname !== KIOSK_CLOSED_PATH && !(await readKioskServiceGate(fetch))) {
		const contextQuery = buildKioskContextQuery(readKioskDisplayQuery(url.searchParams));
		redirect(307, `${resolve(KIOSK_CLOSED_PATH)}${contextQuery}`);
	}
	if (isKioskHomePath(url.pathname) && kioskLanguageSession.needsLanguageChoice) {
		kioskLanguageSession.resetForIdle();
		redirect(307, `${resolve(KIOSK_LANGUAGE_PATH)}${url.search}`);
	}
};
