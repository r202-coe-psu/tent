import { browser } from '$app/environment';

export type LanguageCode = 'th' | 'en';

const STORAGE_KEY = 'tent:lang';

function loadCachedLanguage(): LanguageCode {
	if (!browser) return 'th';
	try {
		const cached = localStorage.getItem(STORAGE_KEY);
		return cached === 'en' || cached === 'th' ? cached : 'th';
	} catch {
		return 'th';
	}
}

export class LanguageStore {
	current = $state<LanguageCode>(loadCachedLanguage());

	setLanguage(lang: LanguageCode) {
		this.current = lang;
		if (browser) {
			try {
				localStorage.setItem(STORAGE_KEY, lang);
			} catch {
				/* storage unavailable */
			}
		}
	}
}

export const languageStore = new LanguageStore();
