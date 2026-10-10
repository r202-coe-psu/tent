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
	KIOSK_LABEL_CHECKBOX,
	KIOSK_LABEL_CHECKLIST,
	KIOSK_LABEL_DIVIDER_MM,
	KIOSK_LABEL_GAP_MM,
	KIOSK_LABEL_TEXT,
	KIOSK_LABEL_TEXT_MIN_WIDTH_MM,
	KIOSK_LABEL_TEXT_ROW_GAP_MM,
	kioskLabelDots,
	kioskLabelLayout,
	kioskLabelPageCss,
	layoutChecklist,
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

	it('puts the QR beside a text column at least the minimum width', () => {
		expect(
			KIOSK_LABEL_TEXT_MIN_WIDTH_MM +
				KIOSK_LABEL_GAP_MM * 2 +
				KIOSK_LABEL_DIVIDER_MM +
				kioskQrBoxMm()
		).toBeLessThanOrEqual(KIOSK_LABEL_MM.width - KIOSK_LABEL_PADDING_MM * 2 + 1e-9);
		expect(kioskQrBoxMm()).toBeLessThanOrEqual(KIOSK_LABEL_MM.height - KIOSK_LABEL_PADDING_MM * 2);
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
		const { qr } = kioskLabelLayout(size.widthPx);
		const marginDots = size.margin * size.dotsPerModule;
		expect(qr.x + marginDots).toBeGreaterThan(0);
		expect(qr.x + size.widthPx - marginDots).toBeLessThan(kioskLabelDots().width);
	});

	it('shrinks rather than overflowing the label for very dense codes', () => {
		const size = kioskQrPrintSize(81);
		expect(size.sizeMm).toBeLessThanOrEqual(kioskQrBoxMm());
		expect(size.dotsPerModule).toBeGreaterThanOrEqual(1);
	});
});

describe('kiosk label canvas', () => {
	it('sizes the canvas in whole printer dots that never exceed the page', () => {
		const dots = kioskLabelDots();
		expect(dots).toEqual({ width: 639, height: 479 });
		expect(dots.width).toBeLessThanOrEqual(mmToDots(KIOSK_LABEL_MM.width));
		expect(dots.height).toBeLessThanOrEqual(mmToDots(KIOSK_LABEL_MM.height));
	});

	it('converts pt to printer dots', () => {
		expect(ptToDots(72)).toBe(203);
		expect(ptToDots(KIOSK_LABEL_TEXT.name.pt)).toBeCloseTo(45.11, 2);
	});

	it('fits the name, phone and a two-row checklist inside the label height', () => {
		const { name, phone, checklist } = KIOSK_LABEL_TEXT;
		const checkRow = Math.max(
			mmToDots(KIOSK_LABEL_CHECKBOX.sizeMm),
			ptToDots(checklist.pt) * checklist.lineHeight
		);
		const used =
			mmToDots(KIOSK_LABEL_PADDING_MM * 2 + KIOSK_LABEL_TEXT_ROW_GAP_MM) +
			ptToDots(name.pt) * name.lineHeight * name.maxLines +
			ptToDots(phone.pt) * phone.lineHeight +
			checkRow * 2 +
			mmToDots(KIOSK_LABEL_CHECKBOX.rowGapMm);
		expect(used).toBeLessThanOrEqual(kioskLabelDots().height);
	});
});

describe('kioskLabelLayout', () => {
	const size = kioskQrPrintSize(QRCode.create(SAMPLE_EVACUEE_ID, {}).modules.size);
	const layout = kioskLabelLayout(size.widthPx);
	const { width, height } = kioskLabelDots();

	it('right-aligns the QR inside the padding and centres it vertically', () => {
		expect(layout.qr.x + size.widthPx).toBe(
			width -
				Math.round(mmToDots(KIOSK_LABEL_PADDING_MM)) +
				Math.round(mmToDots(KIOSK_LABEL_OFFSET_X_MM))
		);
		expect(Math.abs(layout.qr.y * 2 + size.widthPx - height)).toBeLessThanOrEqual(1);
		expect(Number.isInteger(layout.qr.x) && Number.isInteger(layout.qr.y)).toBe(true);
	});

	it('keeps the divider between the text column and the QR', () => {
		expect(layout.text.x + layout.text.width).toBeLessThan(layout.divider.x);
		expect(layout.divider.x + layout.divider.width).toBeLessThan(layout.qr.x);
	});

	it('leaves the text column at least its minimum width', () => {
		expect(layout.text.width).toBeGreaterThanOrEqual(mmToDots(KIOSK_LABEL_TEXT_MIN_WIDTH_MM) - 2);
	});
});

describe('layoutChecklist', () => {
	const metrics = { boxSize: 2, textGap: 1, itemGap: 2 };
	const measure = (text: string) => text.length;

	it('keeps every item on one row when they fit', () => {
		expect(layoutChecklist(['ab', 'cd'], 20, measure, metrics)).toEqual([
			[
				{ text: 'ab', x: 0, width: 5 },
				{ text: 'cd', x: 7, width: 5 }
			]
		]);
	});

	it('wraps the item that would cross the column edge', () => {
		expect(layoutChecklist(['ab', 'cd', 'ef'], 12, measure, metrics)).toEqual([
			[
				{ text: 'ab', x: 0, width: 5 },
				{ text: 'cd', x: 7, width: 5 }
			],
			[{ text: 'ef', x: 0, width: 5 }]
		]);
	});

	it('ships the staff ID card checklist', () => {
		expect(KIOSK_LABEL_CHECKLIST).toEqual(['เช็คอิน', 'คัดกรอง', 'ที่พัก']);
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
