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

/** Oldest age accepted by registration (mirrors `MAX_AGE_YEARS`, CR-148). */
const MAX_AGE = 150;

/** Accepted birth-year range in the calendar the user is typing in (CR-148 FR-07). */
export function birthYearDisplayRange(
	calendar: BirthCalendar,
	now = new Date()
): { min: number; max: number } {
	const max = calendar === 'CE' ? currentYearCE(now) : currentYearBE(now);
	return { min: max - MAX_AGE, max };
}

export type BirthYearProblem = 'digits' | 'range';

/** What is wrong with a typed birth year, in the active calendar — null when valid or empty. */
export function birthYearDisplayProblem(
	display: string,
	calendar: BirthCalendar,
	now = new Date()
): BirthYearProblem | null {
	const value = display.trim();
	if (!value) return null;
	if (!/^\d{4}$/.test(value)) return 'digits';
	const { min, max } = birthYearDisplayRange(calendar, now);
	const year = Number(value);
	return year < min || year > max ? 'range' : null;
}
