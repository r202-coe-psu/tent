/**
 * UI language codes. Lives outside the Svelte language store so pure domain modules can name the
 * type without importing a store (CONVENTIONS §4).
 */
export type LanguageCode = 'th' | 'en';
