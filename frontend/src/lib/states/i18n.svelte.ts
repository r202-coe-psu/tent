import { languageStore, type LanguageCode } from '$lib/stores/language.svelte';

export { languageStore, type LanguageCode };

export const langState = {
	get current(): LanguageCode {
		return languageStore.current;
	},
	set current(val: string) {
		if (val === 'th' || val === 'en') {
			languageStore.setLanguage(val);
		} else {
			languageStore.setLanguage('th');
		}
	}
};
