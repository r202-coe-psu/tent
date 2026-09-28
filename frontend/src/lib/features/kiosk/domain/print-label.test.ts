import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import {
	dotsToMm,
	KIOSK_LABEL_MAX_WIDTH_MM,
	KIOSK_LABEL_MM,
	KIOSK_LABEL_PADDING_MM,
	KIOSK_LABEL_OFFSET_X_MM,
	KIOSK_QR_COLOR,
	KIOSK_QR_MAX_DOTS_PER_MODULE,
	KIOSK_QR_MIN_MM,
	KIOSK_QR_QUIET_ZONE_MODULES,
	KIOSK_LABEL_GAP_MM,
	KIOSK_LABEL_TEXT_MM,
	KIOSK_LABEL_TEXT,
	KIOSK_LABEL_TEXT_ROW_GAP_MM,
	kioskLabelDots,
	kioskLabelPageCss,
	kioskQrBoxMm,
	kioskQrPrintSize,
	mmToDots,
	ptToDots,
	wrapLabelText
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

	it('stacks the QR above the text block', () => {
		expect(kioskQrBoxMm() + KIOSK_LABEL_GAP_MM + KIOSK_LABEL_TEXT_MM).toBeLessThanOrEqual(
			KIOSK_LABEL_MM.height - KIOSK_LABEL_PADDING_MM * 2
		);
		expect(kioskQrBoxMm()).toBeLessThanOrEqual(KIOSK_LABEL_MM.width - KIOSK_LABEL_PADDING_MM * 2);
	});
});

describe('kioskQrPrintSize', () => {
	it('maps an evacuee id QR (version 3) to 8 whole dots per module', () => {
		const moduleCount = QRCode.create(SAMPLE_EVACUEE_ID, {}).modules.size;
		expect(moduleCount).toBe(29);

		const size = kioskQrPrintSize(moduleCount);
		expect(size).toMatchObject({ widthPx: 264, margin: 2, dotsPerModule: 8 });
		expect(size.sizeMm).toBeCloseTo(33.03, 2);
	});

	it.each([21, 25, 29, 33, 37])('uses the largest capped whole-dot module for %i modules', (n) => {
		const size = kioskQrPrintSize(n);
		const nextSizeMm = dotsToMm((n + size.margin * 2) * (size.dotsPerModule + 1));
		expect(size.dotsPerModule).toBeLessThanOrEqual(KIOSK_QR_MAX_DOTS_PER_MODULE);
		if (size.dotsPerModule < KIOSK_QR_MAX_DOTS_PER_MODULE) {
			expect(nextSizeMm).toBeGreaterThan(kioskQrBoxMm());
		}
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
			expect(quietZoneModules).toBeGreaterThanOrEqual(KIOSK_QR_QUIET_ZONE_MODULES - 0.05);
		}
	);

	it('keeps the visible QR modules on the label after the horizontal offset', () => {
		const size = kioskQrPrintSize(QRCode.create(SAMPLE_EVACUEE_ID, {}).modules.size);
		const sideWhiteMm =
			(KIOSK_LABEL_MM.width - size.sizeMm) / 2 + dotsToMm(size.margin * size.dotsPerModule);
		expect(sideWhiteMm).toBeGreaterThan(Math.abs(KIOSK_LABEL_OFFSET_X_MM));
	});

	it('shrinks rather than overflowing the label for very dense codes', () => {
		const size = kioskQrPrintSize(81);
		expect(size.sizeMm).toBeLessThanOrEqual(kioskQrBoxMm());
		expect(size.dotsPerModule).toBeGreaterThanOrEqual(1);
	});
});

describe('kiosk label canvas', () => {
	it('sizes the canvas in whole printer dots', () => {
		expect(kioskLabelDots()).toEqual({ width: 639, height: 480 });
	});

	it('converts pt to printer dots', () => {
		expect(ptToDots(72)).toBe(203);
		expect(ptToDots(KIOSK_LABEL_TEXT.name.pt)).toBeCloseTo(33.83, 2);
	});

	it('fits QR, gaps and every text row inside the label height', () => {
		const size = kioskQrPrintSize(QRCode.create(SAMPLE_EVACUEE_ID, {}).modules.size);
		const rows = [
			KIOSK_LABEL_TEXT.caption.pt * KIOSK_LABEL_TEXT.caption.lineHeight,
			KIOSK_LABEL_TEXT.name.pt * KIOSK_LABEL_TEXT.name.lineHeight * KIOSK_LABEL_TEXT.name.maxLines,
			KIOSK_LABEL_TEXT.detail.pt * KIOSK_LABEL_TEXT.detail.lineHeight
		].reduce((sum, pt) => sum + ptToDots(pt), 0);
		const used =
			mmToDots(KIOSK_LABEL_PADDING_MM * 2 + KIOSK_LABEL_GAP_MM + KIOSK_LABEL_TEXT_ROW_GAP_MM * 2) +
			size.widthPx +
			rows;
		expect(used).toBeLessThanOrEqual(kioskLabelDots().height);
	});
});

describe('wrapLabelText', () => {
	const measure = (text: string) => text.length;

	it('keeps short text on one line', () => {
		expect(wrapLabelText(['สมชาย', ' ', 'ใจดี'], 20, measure, 2)).toEqual(['สมชาย ใจดี']);
	});

	it('breaks between segments and drops the space at the break', () => {
		expect(wrapLabelText(['aaaa', ' ', 'bbbb'], 5, measure, 2)).toEqual(['aaaa', 'bbbb']);
	});

	it('splits a segment wider than the line', () => {
		expect(wrapLabelText(['abcdefgh'], 5, measure, 2)).toEqual(['abcde', 'fgh']);
	});

	it('clamps to the line limit with an ellipsis', () => {
		expect(wrapLabelText(['aaaa', ' ', 'bbbb', ' ', 'cccc'], 5, measure, 2)).toEqual([
			'aaaa',
			'bbbb…'
		]);
		expect(wrapLabelText(['aaaaa', 'bbbbb', 'ccccc'], 5, measure, 2)).toEqual(['aaaaa', 'bbbb…']);
	});

	it('returns no lines for empty text', () => {
		expect(wrapLabelText([], 5, measure, 2)).toEqual([]);
	});
});
