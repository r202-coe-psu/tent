import { describe, expect, it } from 'vitest';
import {
	ageFromBirthYearBE,
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
