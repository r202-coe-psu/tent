import { redirect } from '@sveltejs/kit';
import { kioskLanguageSession } from '$lib/features/kiosk';
import type { LayoutLoad } from './$types';

const KIOSK_HOME_PATHS = ['/kiosk', '/kiosk/'];

/**
 * A fresh kiosk boot lands on the language picker before the method page. `ssr = false`, so this
 * runs in the browser once per page load; the in-memory session then remembers the choice.
 */
export const load: LayoutLoad = ({ url }) => {
	if (KIOSK_HOME_PATHS.includes(url.pathname) && kioskLanguageSession.needsLanguageChoice) {
		kioskLanguageSession.resetForIdle();
		redirect(307, `/kiosk/language${url.search}`);
	}
};
