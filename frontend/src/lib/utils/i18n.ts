import { DISPLAY_LOCALE, DISPLAY_TIME_ZONE } from './date';

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
 * BCP 47 tags used for `Intl` number formatting. Unknown languages fall back
 * to Thai, mirroring `getTranslation`. Date display always uses
 * {@link DISPLAY_LOCALE} — see {@link formatDate}.
 */
const LOCALES: Record<string, string> = {
	th: 'th-TH',
	en: 'en-US'
};

/** Day/short-month/year in Asia/Bangkok, the layout every caller gets unless it asks otherwise. */
const DEFAULT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
	timeZone: DISPLAY_TIME_ZONE,
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
 * Always uses `th-TH` + `Asia/Bangkok` (Buddhist year). Copy language may still
 * be EN; the calendar string does not switch. `options` replaces the default
 * layout rather than merging — same semantics as `Intl.DateTimeFormat` itself —
 * but `timeZone` stays Bangkok unless the caller overrides it.
 *
 * @param value An ISO string, epoch milliseconds, or a `Date`. Empty and
 *   unparseable values render as '': a display helper should print nothing
 *   rather than "Invalid Date".
 * @param _language Ignored for dates (kept for call-site compatibility).
 * @param options Overrides for the default day/short-month/year layout.
 * @returns The formatted date, or '' when there is nothing to show.
 */
export function formatDate(
	value: string | number | Date | null | undefined,
	_language?: string,
	options?: Intl.DateTimeFormatOptions
): string {
	if (value === null || value === undefined || value === '') return '';
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	const resolved: Intl.DateTimeFormatOptions = options
		? { timeZone: DISPLAY_TIME_ZONE, ...options }
		: DEFAULT_DATE_OPTIONS;
	return new Intl.DateTimeFormat(DISPLAY_LOCALE, resolved).format(date);
}
