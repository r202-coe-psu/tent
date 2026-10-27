import { describe, expect, it } from 'vitest';
import { formatBannerWindow } from './kiosk-banner-window';

const now = new Date('2026-10-15T00:00:00.000Z');

describe('formatBannerWindow', () => {
	it('shows one date and the two Bangkok times when the window stays within a day', () => {
		expect(formatBannerWindow('2026-10-15T01:00:00.000Z', '2026-10-15T11:00:00.000Z', now)).toBe(
			'15 ต.ค. 08:00–18:00'
		);
	});

	it('shows both dates when the window crosses a Bangkok midnight', () => {
		// 17:30Z is already 00:30 the next day in Bangkok
		expect(formatBannerWindow('2026-10-15T01:00:00.000Z', '2026-10-15T17:30:00.000Z', now)).toBe(
			'15 ต.ค. 08:00 – 16 ต.ค. 00:30'
		);
	});

	it('adds the Buddhist-era year when it is not the current year', () => {
		expect(formatBannerWindow('2027-01-02T01:00:00.000Z', '2027-01-02T03:00:00.000Z', now)).toBe(
			'2 ม.ค. 2570 08:00–10:00'
		);
	});
});
