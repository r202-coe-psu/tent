import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import {
	dotsToMm,
	KIOSK_LABEL_MAX_WIDTH_MM,
	KIOSK_LABEL_MM,
	KIOSK_LABEL_PADDING_MM,
	KIOSK_QR_COLOR,
	KIOSK_QR_MIN_MM,
	KIOSK_QR_QUIET_ZONE_MODULES,
	kioskLabelPageCss,
	kioskQrPrintSize,
	mmToDots
} from './print-label';

const SAMPLE_EVACUEE_ID = 'evacuee:01K5Z8Q2J9M7X3V4B6N8C0D2EF';

describe('kiosk label size', () => {
	it('fits the XP-365B print width', () => {
		expect(KIOSK_LABEL_MM.width).toBeLessThanOrEqual(KIOSK_LABEL_MAX_WIDTH_MM);
	});

	it('emits a zero-margin @page rule matching the label size', () => {
		expect(kioskLabelPageCss()).toBe(
			`@page{size:${KIOSK_LABEL_MM.width}mm ${KIOSK_LABEL_MM.height}mm;margin:0}`
		);
	});

	it('prints QR in pure black on white', () => {
		expect(KIOSK_QR_COLOR).toEqual({ dark: '#000000', light: '#FFFFFF' });
	});
});

describe('kioskQrPrintSize', () => {
	it('maps an evacuee id QR (version 3) to 6 whole dots per module', () => {
		const moduleCount = QRCode.create(SAMPLE_EVACUEE_ID, {}).modules.size;
		expect(moduleCount).toBe(29);

		const size = kioskQrPrintSize(moduleCount);
		expect(size).toMatchObject({ widthPx: 198, margin: 2, dotsPerModule: 6 });
		expect(size.sizeMm).toBeCloseTo(24.77, 2);
	});

	it.each([21, 25, 29, 33, 37])(
		'keeps %i-module codes scannable and inside the label',
		(moduleCount) => {
			const size = kioskQrPrintSize(moduleCount);
			const visibleMm = dotsToMm(moduleCount * size.dotsPerModule);
			const quietZoneModules = size.margin + mmToDots(KIOSK_LABEL_PADDING_MM) / size.dotsPerModule;

			expect(size.widthPx).toBe((moduleCount + size.margin * 2) * size.dotsPerModule);
			expect(visibleMm).toBeGreaterThanOrEqual(KIOSK_QR_MIN_MM);
			expect(size.sizeMm).toBeLessThanOrEqual(KIOSK_LABEL_MM.height - KIOSK_LABEL_PADDING_MM * 2);
			expect(quietZoneModules).toBeGreaterThanOrEqual(KIOSK_QR_QUIET_ZONE_MODULES);
		}
	);

	it('shrinks rather than overflowing the label for very dense codes', () => {
		const size = kioskQrPrintSize(81);
		expect(size.sizeMm).toBeLessThanOrEqual(KIOSK_LABEL_MM.height - KIOSK_LABEL_PADDING_MM * 2);
		expect(size.dotsPerModule).toBeGreaterThanOrEqual(1);
	});
});
