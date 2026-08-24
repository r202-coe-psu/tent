/**
 * Helper function to get the current translation object based on the language.
 * Default to 'th' if the language is not supported.
 *
 * @param i18n The i18n object containing translations for each language.
 * @param language The current language code.
 * @returns The translation object for the given language.
 */
export function getTranslation<T>(
	i18n: Record<string, T> & { th: T },
	language: string | undefined
): T {
	return i18n[language ?? 'th'] ?? i18n['th'];
}
