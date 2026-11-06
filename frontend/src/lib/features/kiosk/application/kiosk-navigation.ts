import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import type { KioskContextQuery } from '../domain/display-context';
import { kioskLanguageSession } from './kiosk-language-session.svelte';

/** End of a person's flow: back to the method page; the chosen language stays. */
export function navigateToKioskHome(contextQuery: KioskContextQuery): void {
	void goto(resolve(`/kiosk${contextQuery}`));
}

/** Idle attract banner dismissed: a new person is at the kiosk, so Thai again and pick a language. */
export function returnToKioskLanguagePicker(contextQuery: KioskContextQuery): void {
	kioskLanguageSession.resetForIdle();
	void goto(resolve(`/kiosk/language${contextQuery}`));
}
