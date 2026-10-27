import { describe, expect, it } from 'vitest';
import { PREVIEW_FRAMES, fitScale } from './kiosk-banner-preview-frame';

describe('PREVIEW_FRAMES', () => {
	it('are the two kiosk screens (FR-KBN-29)', () => {
		expect(PREVIEW_FRAMES.map((f) => [f.id, f.width, f.height])).toEqual([
			['compact', 1024, 600],
			['portrait', 1080, 1920]
		]);
	});
});

describe('fitScale', () => {
	const compact = { width: 1024, height: 600 };

	it('shrinks to the limiting side', () => {
		expect(fitScale(compact, { width: 512, height: 1000 })).toBe(0.5);
		expect(fitScale(compact, { width: 2000, height: 300 })).toBe(0.5);
	});

	it('never enlarges past 1:1', () => {
		expect(fitScale(compact, { width: 5000, height: 5000 })).toBe(1);
	});

	it('returns a tiny positive scale for a zero-sized space instead of 0', () => {
		expect(fitScale(compact, { width: 0, height: 0 })).toBeGreaterThan(0);
	});
});
