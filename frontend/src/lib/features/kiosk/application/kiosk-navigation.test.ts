import { beforeEach, describe, expect, it, vi } from 'vitest';

const { gotoMock, resolveMock } = vi.hoisted(() => ({
	gotoMock: vi.fn(),
	resolveMock: vi.fn((path: string) => path)
}));

vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$app/paths', () => ({ resolve: resolveMock }));

import { languageStore } from '$lib/stores/language.svelte';
import { kioskLanguageSession } from './kiosk-language-session.svelte';
import { navigateToKioskHome, returnToKioskLanguagePicker } from './kiosk-navigation';

describe('kiosk visit end', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('resets to Thai, asks for a choice again and opens the picker with kiosk context', () => {
		languageStore.setLanguage('en');
		kioskLanguageSession.markChosen();

		returnToKioskLanguagePicker('?shelter_code=SH001');

		expect(languageStore.current).toBe('th');
		expect(kioskLanguageSession.needsLanguageChoice).toBe(true);
		expect(gotoMock).toHaveBeenCalledWith('/kiosk/language?shelter_code=SH001');
	});

	it('ends the visit at the end of a flow: Thai again and the picker for the next person', () => {
		languageStore.setLanguage('en');
		kioskLanguageSession.markChosen();

		navigateToKioskHome('?shelter_code=SH001');

		expect(languageStore.current).toBe('th');
		expect(kioskLanguageSession.needsLanguageChoice).toBe(true);
		expect(resolveMock).toHaveBeenCalledWith('/kiosk/language?shelter_code=SH001');
		expect(gotoMock).toHaveBeenCalledWith('/kiosk/language?shelter_code=SH001');
	});
});
