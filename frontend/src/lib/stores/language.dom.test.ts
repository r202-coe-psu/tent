// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LanguageStore } from './language.svelte';

describe('LanguageStore and the document language', () => {
	beforeEach(() => {
		localStorage.clear();
		document.documentElement.lang = 'th-TH';
	});

	afterEach(() => {
		localStorage.clear();
		document.documentElement.lang = '';
	});

	it('sets <html lang> to en when the language is switched to EN and back to th-TH for TH', () => {
		const store = new LanguageStore();

		store.setLanguage('en');
		expect(document.documentElement.lang).toBe('en');

		store.setLanguage('th');
		expect(document.documentElement.lang).toBe('th-TH');
	});

	it('sets <html lang> from the cached language when the store is created', () => {
		localStorage.setItem('tent:lang', 'en');

		new LanguageStore();

		expect(document.documentElement.lang).toBe('en');
	});
});
