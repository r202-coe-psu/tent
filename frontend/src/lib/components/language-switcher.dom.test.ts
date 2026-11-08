// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { languageStore } from '$lib/stores/language.svelte';
import LanguageSwitcher from './language-switcher.svelte';

let instance: ReturnType<typeof mount> | null = null;

afterEach(async () => {
	if (instance) await unmount(instance);
	instance = null;
	languageStore.setLanguage('th');
	document.body.innerHTML = '';
});

function render() {
	instance = mount(LanguageSwitcher, { target: document.body });
	flushSync();
	const button = document.body.querySelector('button');
	expect(button).not.toBeNull();
	return button!;
}

describe('LanguageSwitcher', () => {
	it('is one button that shows the current language', () => {
		languageStore.setLanguage('th');
		const button = render();
		expect(document.body.querySelectorAll('button')).toHaveLength(1);
		expect(button.textContent?.trim()).toBe('TH');
		expect(button.getAttribute('aria-label')).toBe('TH — Switch to English');
	});

	it('flips TH ⇄ EN on each click', () => {
		languageStore.setLanguage('th');
		const button = render();

		button.click();
		flushSync();
		expect(languageStore.current).toBe('en');
		expect(button.textContent?.trim()).toBe('EN');
		expect(button.getAttribute('aria-label')).toBe('EN — เปลี่ยนเป็นภาษาไทย');

		button.click();
		flushSync();
		expect(languageStore.current).toBe('th');
		expect(button.textContent?.trim()).toBe('TH');
	});
});
