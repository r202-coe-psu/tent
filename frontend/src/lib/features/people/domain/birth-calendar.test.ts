import { describe, expect, it } from 'vitest';
import {
	ageFromBirthYearBE,
	birthYearDisplayProblem,
	birthYearDisplayRange,
	currentYearBE,
	defaultBirthCalendar,
	toDisplayBirthYear,
	toPersistBirthYearBE
} from './birth-calendar';

describe('birth-calendar', () => {
	it('defaults th → BE and en → CE', () => {
		expect(defaultBirthCalendar('th')).toBe('BE');
		expect(defaultBirthCalendar('en')).toBe('CE');
		expect(defaultBirthCalendar(undefined)).toBe('BE');
	});

	it('converts display years to/from persisted พ.ศ.', () => {
		expect(toPersistBirthYearBE(2535, 'BE')).toBe(2535);
		expect(toPersistBirthYearBE(1992, 'CE')).toBe(2535);
		expect(toDisplayBirthYear(2535, 'BE')).toBe(2535);
		expect(toDisplayBirthYear(2535, 'CE')).toBe(1992);
	});

	it('derives age from พ.ศ. birth year', () => {
		const be = currentYearBE();
		expect(ageFromBirthYearBE(be)).toBe(0);
		expect(ageFromBirthYearBE(be - 35)).toBe(35);
	});

	it('keeps age stable when toggling display calendar (persist stays พ.ศ.)', () => {
		const be = 2535;
		const displayCe = toDisplayBirthYear(be, 'CE');
		expect(toPersistBirthYearBE(displayCe, 'CE')).toBe(be);
		expect(ageFromBirthYearBE(toPersistBirthYearBE(displayCe, 'CE'))).toBe(ageFromBirthYearBE(be));
	});
});

describe('birthYearDisplayProblem (CR-148 FR-04 / FR-07)', () => {
	const now = new Date('2026-10-03T00:00:00Z');

	it('reports digits and range problems in the active calendar', () => {
		expect(birthYearDisplayProblem('253', 'BE', now)).toBe('digits');
		expect(birthYearDisplayProblem('2533', 'BE', now)).toBeNull();
		expect(birthYearDisplayProblem('2419', 'BE', now)).toBeNull();
		expect(birthYearDisplayProblem('2418', 'BE', now)).toBe('range');
		expect(birthYearDisplayProblem('1990', 'CE', now)).toBeNull();
		expect(birthYearDisplayProblem('2533', 'CE', now)).toBe('range');
		expect(birthYearDisplayProblem('', 'CE', now)).toBeNull();
	});

	it('gives the accepted range per calendar', () => {
		expect(birthYearDisplayRange('BE', now)).toEqual({ min: 2419, max: 2569 });
		expect(birthYearDisplayRange('CE', now)).toEqual({ min: 1876, max: 2026 });
	});
});
