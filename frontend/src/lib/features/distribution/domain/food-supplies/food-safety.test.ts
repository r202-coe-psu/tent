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
