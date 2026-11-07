import { describe, expect, it } from 'vitest';
import { KIOSK_LABEL_MM, KIOSK_PRINT_DPI, kioskLabelDots, mmToDots } from './label-size';

describe('label size', () => {
	it('is 80x60 mm at 203 dpi', () => {
		expect(KIOSK_PRINT_DPI).toBe(203);
		expect(KIOSK_LABEL_MM).toEqual({ width: 80, height: 60 });
	});

	it('rounds the label down to 639x479 whole dots', () => {
		expect(kioskLabelDots()).toEqual({ width: 639, height: 479 });
	});

	it('converts mm to (fractional) dots', () => {
		// 25.4 mm is exactly one inch
		expect(mmToDots(25.4)).toBeCloseTo(203, 10);
	});
});
