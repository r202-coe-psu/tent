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

/**
 * 🔢 ฟังก์ชันจัดรูปแบบตัวเลขทั่วไป
 */
export function formatNumber(num: number | null | undefined, lang: string = 'th'): string {
	if (num === null || num === undefined) return '0';
	const locale = lang === 'en' ? 'en-US' : 'th-TH';
	return new Intl.NumberFormat(locale).format(num);
}

/**
 * 📅 ฟังก์ชันจัดรูปแบบวันที่
 */
export function formatDate(
	date: string | number | Date | null | undefined,
	lang: string = 'th',
	options: Intl.DateTimeFormatOptions = {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	}
): string {
	if (!date) return '';
	const locale = lang === 'en' ? 'en-US' : 'th-TH';
	return new Date(date).toLocaleString(locale, options);
}
