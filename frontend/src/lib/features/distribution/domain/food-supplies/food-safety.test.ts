import { describe, expect, it } from 'vitest';
import { isLotExpired, lotExpiryStatus } from './food-safety';

const NOW = Date.parse('2026-10-10T12:00:00.000Z');

describe('lotExpiryStatus (FR-MQW-06 B)', () => {
	it('counts whole minutes left before expiry', () => {
		expect(lotExpiryStatus('2026-10-10T13:30:30.000Z', NOW)).toEqual({
			expiry: '2026-10-10T13:30:30.000Z',
			isExpired: false,
			minutesLeft: 90
		});
	});

	it('is expired at and after the expiry instant', () => {
		expect(lotExpiryStatus('2026-10-10T12:00:00.000Z', NOW)?.isExpired).toBe(true);
		expect(lotExpiryStatus('2026-10-10T11:00:00.000Z', NOW)).toMatchObject({
			isExpired: true,
			minutesLeft: 0
		});
	});

	it('keeps a bare date usable through the Bangkok day and expires it at midnight (CR-195)', () => {
		const at = (iso: string) => Date.parse(iso);
		expect(lotExpiryStatus('2026-10-23', at('2026-10-23T07:30:00+07:00'))?.isExpired).toBe(false);
		expect(lotExpiryStatus('2026-10-23', at('2026-10-23T23:00:00+07:00'))).toMatchObject({
			isExpired: false,
			minutesLeft: 60
		});
		expect(lotExpiryStatus('2026-10-23', at('2026-10-24T00:00:00+07:00'))?.isExpired).toBe(true);
	});

	it('keeps an offset datetime at its own instant (AC-X6)', () => {
		const expiry = '2026-10-23T14:30:00+07:00';
		expect(lotExpiryStatus(expiry, Date.parse('2026-10-23T14:29:00+07:00'))?.isExpired).toBe(false);
		expect(lotExpiryStatus(expiry, Date.parse('2026-10-23T14:30:00+07:00'))?.isExpired).toBe(true);
	});

	it('returns null without a usable expiry', () => {
		expect(lotExpiryStatus(undefined, NOW)).toBeNull();
		expect(lotExpiryStatus('', NOW)).toBeNull();
		expect(lotExpiryStatus('not-a-date', NOW)).toBeNull();
	});
});

describe('isLotExpired', () => {
	it('is false when the expiry is unknown', () => {
		expect(isLotExpired(null, NOW)).toBe(false);
	});

	it('is true once the expiry has passed', () => {
		expect(isLotExpired('2026-10-10T11:59:00.000Z', NOW)).toBe(true);
	});
});
