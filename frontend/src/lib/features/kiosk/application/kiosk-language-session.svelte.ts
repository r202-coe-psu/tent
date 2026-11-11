import { languageStore } from '$lib/stores/language.svelte';

/**
 * Whether the person at the kiosk has picked a language yet. A fresh page load (boot) and the idle
 * attract banner both start a new session: Thai again, choice required. Held in memory on purpose,
 * so restarting the kiosk browser is a new session too.
 */
export class KioskLanguageSession {
	needsLanguageChoice = $state(true);

	markChosen(): void {
		this.needsLanguageChoice = false;
	}

	resetForIdle(): void {
		languageStore.setLanguage('th');
		this.needsLanguageChoice = true;
	}
}

export const kioskLanguageSession = new KioskLanguageSession();
