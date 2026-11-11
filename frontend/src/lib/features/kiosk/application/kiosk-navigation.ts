import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import type { KioskContextQuery } from '../domain/display-context';
import { KIOSK_LANGUAGE_PATH } from '../domain/identity-method';
import { kioskLanguageSession } from './kiosk-language-session.svelte';

/**
 * End of a person's visit (done, gave up, idle): the next person must not inherit their language,
 * so Thai again and the language picker. A back button inside a flow links to the method page
 * instead and keeps the language.
 */
export function navigateToKioskHome(contextQuery: KioskContextQuery): void {
	returnToKioskLanguagePicker(contextQuery);
}

/** Idle attract banner dismissed: a new person is at the kiosk, so Thai again and pick a language. */
export function returnToKioskLanguagePicker(contextQuery: KioskContextQuery): void {
	kioskLanguageSession.resetForIdle();
	void goto(resolve(`${KIOSK_LANGUAGE_PATH}${contextQuery}`));
}

/** A work request was refused because the kiosk is closed (403 KIOSK_CLOSED): show the closed page. */
export function goToKioskClosed(contextQuery: KioskContextQuery = ''): void {
	void goto(resolve(`/kiosk/closed${contextQuery}`), { replaceState: true });
}
