import { describe, expect, it } from 'vitest';
import { fromBangkokLocalInput, toBangkokLocalInput } from './kiosk-banner-datetime';

describe('toBangkokLocalInput', () => {
	it('renders a UTC instant as Asia/Bangkok wall-clock time', () => {
		expect(toBangkokLocalInput('2026-10-14T17:00:00.000Z')).toBe('2026-10-15T00:00');
		expect(toBangkokLocalInput('2026-10-15T16:59:00Z')).toBe('2026-10-15T23:59');
	});

	it('crosses year boundaries', () => {
		expect(toBangkokLocalInput('2026-12-31T18:30:00Z')).toBe('2027-01-01T01:30');
	});
});

describe('fromBangkokLocalInput', () => {
	it('treats the input as +07:00 and returns UTC ISO', () => {
		expect(fromBangkokLocalInput('2026-10-15T00:00')).toBe('2026-10-14T17:00:00.000Z');
		expect(fromBangkokLocalInput('2027-01-01T01:30')).toBe('2026-12-31T18:30:00.000Z');
	});

	it('accepts seconds in the local value', () => {
		expect(fromBangkokLocalInput('2026-10-15T08:00:30')).toBe('2026-10-15T01:00:30.000Z');
	});

	it('returns null for empty or malformed input', () => {
		expect(fromBangkokLocalInput('')).toBeNull();
		expect(fromBangkokLocalInput('not-a-date')).toBeNull();
		expect(fromBangkokLocalInput('2026-13-40T00:00')).toBeNull();
	});

	it('round-trips with toBangkokLocalInput', () => {
		for (const local of ['2026-03-01T00:00', '2026-10-15T12:34', '2026-12-31T23:59']) {
			const iso = fromBangkokLocalInput(local);
			expect(iso).not.toBeNull();
			expect(toBangkokLocalInput(iso as string)).toBe(local);
		}
	});
});
