import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { isKioskHomePath, kioskLanguageSession, KIOSK_LANGUAGE_PATH } from '$lib/features/kiosk';
import type { LayoutLoad } from './$types';

/**
 * A fresh kiosk boot lands on the language picker before the method page. `ssr = false`, so this
 * runs in the browser once per page load; the in-memory session then remembers the choice.
 */
export const load: LayoutLoad = ({ url }) => {
	if (isKioskHomePath(url.pathname) && kioskLanguageSession.needsLanguageChoice) {
		kioskLanguageSession.resetForIdle();
		redirect(307, `${resolve(KIOSK_LANGUAGE_PATH)}${url.search}`);
	}
};
