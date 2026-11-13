import { describe, expect, it } from 'vitest';
import { isQrCardStale } from './qr-card-staleness';

describe('isQrCardStale', () => {
	it('is false when the card was never printed', () => {
		expect(isQrCardStale('red', [])).toBe(false);
	});

	it('is false when the latest card carries the current level', () => {
		expect(isQrCardStale('red', [{ printed_at: '2026-11-01T08:00:00Z', marker: 'red' }])).toBe(
			false
		);
	});

	it('is true when the level went from red to yellow after the latest print', () => {
		expect(isQrCardStale('yellow', [{ printed_at: '2026-11-01T08:00:00Z', marker: 'red' }])).toBe(
			true
		);
	});

	it('is true when the level was cleared after a yellow card was printed', () => {
		expect(isQrCardStale(null, [{ printed_at: '2026-11-01T08:00:00Z', marker: 'yellow' }])).toBe(
			true
		);
	});

	it('treats a legacy entry without marker as no level: not stale when current is null', () => {
		expect(isQrCardStale(null, [{ printed_at: '2026-11-01T08:00:00Z' }])).toBe(false);
	});

	it('treats a legacy entry without marker as no level: stale when current is red', () => {
		expect(isQrCardStale('red', [{ printed_at: '2026-11-01T08:00:00Z' }])).toBe(true);
	});

	it('only the last entry counts', () => {
		expect(
			isQrCardStale(null, [
				{ printed_at: '2026-11-01T08:00:00Z', marker: 'red' },
				{ printed_at: '2026-11-02T08:00:00Z', marker: null }
			])
		).toBe(false);
	});
});
