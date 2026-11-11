import { beforeEach, describe, expect, it } from 'vitest';
import { languageStore } from '$lib/stores/language.svelte';
import { KioskLanguageSession } from './kiosk-language-session.svelte';

describe('KioskLanguageSession', () => {
	beforeEach(() => languageStore.setLanguage('th'));

	it('needs a language choice on a fresh session', () => {
		expect(new KioskLanguageSession().needsLanguageChoice).toBe(true);
	});

	it('stops needing a choice once one is made', () => {
		const session = new KioskLanguageSession();
		session.markChosen();
		expect(session.needsLanguageChoice).toBe(false);
	});

	it('goes back to Thai and asks again when the kiosk idles', () => {
		const session = new KioskLanguageSession();
		languageStore.setLanguage('en');
		session.markChosen();

		session.resetForIdle();

		expect(languageStore.current).toBe('th');
		expect(session.needsLanguageChoice).toBe(true);
	});
});
