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
	KIOSK_LABEL_LAYOUT,
	KIOSK_LABEL_TEXT_MM,
	kioskLabelPageCss,
	kioskQrBoxMm,
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

	it('stacks the QR above the text on the 60x60 mm label and leaves room for the text', () => {
		expect(KIOSK_LABEL_LAYOUT).toBe('stacked');
		expect(kioskQrBoxMm() + KIOSK_LABEL_TEXT_MM).toBeLessThanOrEqual(
			KIOSK_LABEL_MM.height - KIOSK_LABEL_PADDING_MM * 2
		);
	});
});

describe('kioskQrPrintSize', () => {
	it('maps an evacuee id QR (version 3) to 8 whole dots per module', () => {
		const moduleCount = QRCode.create(SAMPLE_EVACUEE_ID, {}).modules.size;
		expect(moduleCount).toBe(29);

		const size = kioskQrPrintSize(moduleCount);
		// 2 mm label padding is 15.98 dots (< 2 modules), so the image margin grows to 3 modules.
		expect(size).toMatchObject({ widthPx: 280, margin: 3, dotsPerModule: 8 });
		expect(size.sizeMm).toBeCloseTo(35.03, 2);
	});

	it.each([21, 25, 29, 33, 37])(
		'keeps %i-module codes scannable and inside the label',
		(moduleCount) => {
			const size = kioskQrPrintSize(moduleCount);
			const visibleMm = dotsToMm(moduleCount * size.dotsPerModule);
			const quietZoneModules = size.margin + mmToDots(KIOSK_LABEL_PADDING_MM) / size.dotsPerModule;

			expect(size.widthPx).toBe((moduleCount + size.margin * 2) * size.dotsPerModule);
			expect(visibleMm).toBeGreaterThanOrEqual(KIOSK_QR_MIN_MM);
			expect(size.sizeMm).toBeLessThanOrEqual(kioskQrBoxMm());
			expect(quietZoneModules).toBeGreaterThanOrEqual(KIOSK_QR_QUIET_ZONE_MODULES);
		}
	);

	it('shrinks rather than overflowing the label for very dense codes', () => {
		const size = kioskQrPrintSize(81);
		expect(size.sizeMm).toBeLessThanOrEqual(kioskQrBoxMm());
		expect(size.dotsPerModule).toBeGreaterThanOrEqual(1);
	});
});
