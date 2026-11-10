import { beforeEach, describe, expect, it } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { languageStore } from '$lib/stores/language.svelte';
import { kioskLanguageSession } from '$lib/features/kiosk';
import { load } from './+layout';

function visit(path: string): unknown {
	try {
		return load({ url: new URL(`http://kiosk.test${path}`) } as unknown as Parameters<
			typeof load
		>[0]);
	} catch (thrown) {
		return thrown;
	}
}

describe('kiosk layout language gate', () => {
	beforeEach(() => {
		languageStore.setLanguage('en');
		kioskLanguageSession.markChosen();
	});

	it('sends the first visit of /kiosk to the language page, in Thai, keeping the shelter context', () => {
		kioskLanguageSession.resetForIdle();
		languageStore.setLanguage('en');

		const result = visit('/kiosk?shelter_name=A');

		expect(isRedirect(result) && result.location).toBe('/kiosk/language?shelter_name=A');
		expect(languageStore.current).toBe('th');
	});

	it('lets /kiosk open once a language has been chosen', () => {
		expect(isRedirect(visit('/kiosk'))).toBe(false);
	});

	it('does not gate other kiosk pages, even before a choice', () => {
		kioskLanguageSession.resetForIdle();

		expect(isRedirect(visit('/kiosk/language'))).toBe(false);
		expect(isRedirect(visit('/kiosk/qr'))).toBe(false);
	});
});
