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
 * BCP 47 tags used for `Intl` formatting. Unknown languages fall back to Thai,
 * mirroring `getTranslation`.
 */
const LOCALES: Record<string, string> = {
	th: 'th-TH',
	en: 'en-US'
};

/** Day/short-month/year, the layout every caller gets unless it asks otherwise. */
const DEFAULT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
	day: '2-digit',
	month: 'short',
	year: 'numeric'
};

function resolveLocale(language: string | undefined): string {
	return LOCALES[language ?? 'th'] ?? LOCALES.th;
}

/**
 * Format a number for display with locale digit grouping.
 *
 * @param value The number to format. `null`/`undefined` render as "0" so a
 *   missing count reads the same as a zero one on screen.
 * @param language The current language code. Defaults to 'th'.
 * @returns The grouped number as a string.
 */
export function formatNumber(value: number | null | undefined, language?: string): string {
	if (value === null || value === undefined) return '0';
	return new Intl.NumberFormat(resolveLocale(language)).format(value);
}

/**
 * Format a date for display.
 *
 * Thai dates land on the Buddhist calendar that `th-TH` carries, so 2025 reads
 * 2568. `options` replaces the default layout rather than merging with it —
 * the same semantics `Intl.DateTimeFormat` itself has.
 *
 * @param value An ISO string, epoch milliseconds, or a `Date`. Empty and
 *   unparseable values render as '': a display helper should print nothing
 *   rather than "Invalid Date".
 * @param language The current language code. Defaults to 'th'.
 * @param options Overrides for the default day/short-month/year layout.
 * @returns The formatted date, or '' when there is nothing to show.
 */
export function formatDate(
	value: string | number | Date | null | undefined,
	language?: string,
	options?: Intl.DateTimeFormatOptions
): string {
	if (value === null || value === undefined || value === '') return '';
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	return new Intl.DateTimeFormat(resolveLocale(language), options ?? DEFAULT_DATE_OPTIONS).format(
		date
	);
}
