import { browser } from '$app/environment';

export type LanguageCode = 'th' | 'en';

const STORAGE_KEY = 'tent:lang';
const LEGACY_STORAGE_KEY = 'app-lang';

function loadCachedLanguage(): LanguageCode {
	if (!browser) return 'th';
	try {
		const cached = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
		return cached === 'en' || cached === 'th' ? cached : 'th';
	} catch {
		return 'th';
	}
}

/** BCP 47 tag for `<html lang>`; Thai keeps the value `app.html` ships with. */
const HTML_LANG: Record<LanguageCode, string> = { th: 'th-TH', en: 'en' };

function syncDocumentLanguage(lang: LanguageCode) {
	if (typeof document === 'undefined') return;
	document.documentElement.lang = HTML_LANG[lang];
}

export class LanguageStore {
	current = $state<LanguageCode>(loadCachedLanguage());

	constructor() {
		syncDocumentLanguage(this.current);
	}

	setLanguage(lang: LanguageCode) {
		this.current = lang;
		syncDocumentLanguage(lang);
		if (browser) {
			try {
				localStorage.setItem(STORAGE_KEY, lang);
				localStorage.setItem(LEGACY_STORAGE_KEY, lang);
			} catch {
				/* storage unavailable */
			}
		}
	}
}

export const languageStore = new LanguageStore();
