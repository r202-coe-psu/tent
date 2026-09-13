/**
 * Birth-year calendar display helpers for registration forms.
 * Persist is always Buddhist Era (พ.ศ.); UI may show BE or CE.
 */
import type { LanguageCode } from '$lib/stores/language.svelte';

export type BirthCalendar = 'BE' | 'CE';

const BE_OFFSET = 543;

export function defaultBirthCalendar(lang: LanguageCode | string | undefined): BirthCalendar {
	return lang === 'en' ? 'CE' : 'BE';
}

export function currentYearBE(now = new Date()): number {
	return now.getFullYear() + BE_OFFSET;
}

export function currentYearCE(now = new Date()): number {
	return now.getFullYear();
}

/** Convert a persisted พ.ศ. year to the year shown in the active calendar. */
export function toDisplayBirthYear(beYear: number, calendar: BirthCalendar): number {
	return calendar === 'CE' ? beYear - BE_OFFSET : beYear;
}

/** Convert a UI display year back to persisted พ.ศ. */
export function toPersistBirthYearBE(displayYear: number, calendar: BirthCalendar): number {
	return calendar === 'CE' ? displayYear + BE_OFFSET : displayYear;
}

export function ageFromBirthYearBE(beYear: number, now = new Date()): number {
	return Math.max(0, currentYearBE(now) - beYear);
}
