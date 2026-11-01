import { describe, expect, it } from 'vitest';
import { expiryInstant, isExpiryPassed } from './expiry-instant';

const at = (iso: string) => Date.parse(iso);

describe('expiryInstant', () => {
	it('reads a bare date as 00:00 Bangkok of the next day', () => {
		expect(expiryInstant('2026-10-23')).toBe(at('2026-10-24T00:00:00+07:00'));
		expect(expiryInstant('2026-10-23')).toBe(at('2026-10-23T17:00:00Z'));
	});

	it('rolls a bare date over month and year ends', () => {
		expect(expiryInstant('2026-12-31')).toBe(at('2027-01-01T00:00:00+07:00'));
		expect(expiryInstant('2028-02-29')).toBe(at('2028-03-01T00:00:00+07:00'));
	});

	it('keeps a datetime with an offset or Z at its own instant', () => {
		expect(expiryInstant('2026-10-23T14:30:00+07:00')).toBe(at('2026-10-23T14:30:00+07:00'));
		expect(expiryInstant('2026-10-23T07:30:00.000Z')).toBe(at('2026-10-23T14:30:00+07:00'));
		expect(expiryInstant('2026-10-23T14:30:00+0700')).toBe(at('2026-10-23T14:30:00+07:00'));
	});

	it('reads a legacy datetime with no offset as Bangkok time', () => {
		expect(expiryInstant('2026-10-23T14:30:00')).toBe(at('2026-10-23T14:30:00+07:00'));
		expect(expiryInstant('2026-10-23T14:30')).toBe(at('2026-10-23T14:30:00+07:00'));
	});

	it.each([undefined, null, '', '   ', 'abc', '23/10/2026', '2026-10-23 25:99', '2026-10'])(
		'is NaN for %j',
		(value) => {
			expect(expiryInstant(value)).toBeNaN();
		}
	);

	it('is NaN for a date that is not on the calendar', () => {
		expect(expiryInstant('2026-02-30')).toBeNaN();
		expect(expiryInstant('2026-13-01')).toBeNaN();
		expect(expiryInstant('2027-02-29')).toBeNaN();
		expect(expiryInstant('2026-02-30T10:00:00+07:00')).toBeNaN();
	});
});

describe('isExpiryPassed', () => {
	const expiry = '2026-10-23';

	it('AC-X1: still usable at 07:30 on the expiry day', () => {
		expect(isExpiryPassed(expiry, at('2026-10-23T07:30:00+07:00'))).toBe(false);
	});

	it('AC-X2: still usable at 23:59:59 on the expiry day', () => {
		expect(isExpiryPassed(expiry, at('2026-10-23T23:59:59+07:00'))).toBe(false);
	});

	it('AC-X3: expired at 00:00:00 the next day', () => {
		expect(isExpiryPassed(expiry, at('2026-10-24T00:00:00+07:00'))).toBe(true);
	});

	it('AC-X4: expired at 03:00 the next day, while the UTC date is still the 23rd', () => {
		expect(isExpiryPassed(expiry, at('2026-10-24T03:00:00+07:00'))).toBe(true);
	});

	it('AC-X5: yesterday expired by 10:00 today', () => {
		expect(isExpiryPassed('2026-10-22', at('2026-10-23T10:00:00+07:00'))).toBe(true);
	});

	it('AC-X6: a datetime expires at its own minute', () => {
		const dt = '2026-10-23T14:30:00+07:00';
		expect(isExpiryPassed(dt, at('2026-10-23T14:29:00+07:00'))).toBe(false);
		expect(isExpiryPassed(dt, at('2026-10-23T14:30:00+07:00'))).toBe(true);
	});

	it('a legacy datetime with no offset expires on the Bangkok clock', () => {
		const dt = '2026-10-23T14:30:00';
		expect(isExpiryPassed(dt, at('2026-10-23T14:29:59+07:00'))).toBe(false);
		expect(isExpiryPassed(dt, at('2026-10-23T14:30:00+07:00'))).toBe(true);
	});

	it.each([undefined, null, '', 'abc', '2026-02-30'])('AC-X7: %j is never passed', (value) => {
		expect(isExpiryPassed(value, at('2099-01-01T00:00:00+07:00'))).toBe(false);
	});
});
