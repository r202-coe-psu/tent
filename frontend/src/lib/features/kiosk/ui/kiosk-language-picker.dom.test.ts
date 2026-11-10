// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { goto } from '$app/navigation';
import { languageStore } from '$lib/stores/language.svelte';
import { kioskLanguageSession } from '../application/kiosk-language-session.svelte';
import KioskLanguagePicker from './kiosk-language-picker.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

let instance: ReturnType<typeof mount> | null = null;

function mountPicker(contextQuery: '' | `?${string}` = '') {
	instance = mount(KioskLanguagePicker, { target: document.body, props: { contextQuery } });
	flushSync();
}

const button = (code: 'th' | 'en') =>
	document.querySelector<HTMLButtonElement>(`button[data-language="${code}"]`)!;

beforeEach(() => {
	vi.clearAllMocks();
	languageStore.setLanguage('th');
	kioskLanguageSession.resetForIdle();
});
afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('KioskLanguagePicker (DOM)', () => {
	it('tapping English switches to English and opens the method page', () => {
		mountPicker();

		button('en').click();

		expect(languageStore.current).toBe('en');
		expect(goto).toHaveBeenCalledWith('/kiosk');
	});

	it('tapping Thai keeps Thai, stops asking for a choice, and keeps the shelter context', () => {
		mountPicker('?shelter_name=A');

		button('th').click();

		expect(languageStore.current).toBe('th');
		expect(kioskLanguageSession.needsLanguageChoice).toBe(false);
		expect(goto).toHaveBeenCalledWith('/kiosk?shelter_name=A');
	});
});
