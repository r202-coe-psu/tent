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
	KIOSK_LABEL_BAND,
	KIOSK_LABEL_CHECKBOX,
	KIOSK_LABEL_CHECKLIST,
	KIOSK_CHECK_IN_TICKS,
	KIOSK_LABEL_DIVIDER_MM,
	KIOSK_LABEL_GAP_MM,
	KIOSK_LABEL_LINK,
	KIOSK_LABEL_TEXT,
	KIOSK_LABEL_TEXT_MIN_WIDTH_MM,
	KIOSK_LABEL_TEXT_OFFSET_Y_MM,
	KIOSK_LABEL_LINK_GAP_MM,
	KIOSK_LABEL_ZONE,
	KIOSK_LABEL_ZONE_PREFIX,
	kioskLabelBars,
	kioskLabelDots,
	kioskLabelLayout,
	kioskLabelPageCss,
	kioskQrBoxMm,
	kioskQrPrintSize,
	labelZoneLine,
	mmToDots,
	ptToDots,
	wrapLabelName,
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
		expect(KIOSK_LABEL_TEXT.name.pt).toBe(12);
		expect(ptToDots(KIOSK_LABEL_TEXT.name.pt)).toBeCloseTo(33.83, 2);
	});

	it('fits a 3-line name, the zone, the emergency row, one checklist row per item and the link', () => {
		const { name, zone, emergency, checklist, link } = KIOSK_LABEL_TEXT;
		const checkRow = Math.max(
			mmToDots(KIOSK_LABEL_CHECKBOX.sizeMm),
			ptToDots(checklist.pt) * checklist.lineHeight
		);
		const rows = KIOSK_LABEL_CHECKLIST.length;
		const used =
			mmToDots(KIOSK_LABEL_PADDING_MM * 2 + KIOSK_LABEL_TEXT_OFFSET_Y_MM) +
			ptToDots(name.pt) * name.lineHeight * name.maxLines +
			mmToDots(KIOSK_LABEL_ZONE.rowGapMm) +
			ptToDots(zone.pt) * zone.lineHeight +
			mmToDots(KIOSK_LABEL_ZONE.rowGapMm) +
			ptToDots(emergency.pt) * emergency.lineHeight +
			checkRow * rows +
			mmToDots(KIOSK_LABEL_CHECKBOX.rowGapMm) * (rows - 1) +
			mmToDots(KIOSK_LABEL_LINK_GAP_MM) +
			ptToDots(link.pt) * link.lineHeight;
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

	it('starts the name below the padding by the top text offset', () => {
		expect(layout.text.y).toBe(
			Math.round(mmToDots(KIOSK_LABEL_PADDING_MM)) +
				Math.round(mmToDots(KIOSK_LABEL_TEXT_OFFSET_Y_MM))
		);
		expect(layout.text.bottom).toBe(height - Math.round(mmToDots(KIOSK_LABEL_PADDING_MM)));
	});

	it('prints the link small at the bottom-left of the text column', () => {
		const half = (ptToDots(KIOSK_LABEL_TEXT.link.pt) * KIOSK_LABEL_TEXT.link.lineHeight) / 2;

		expect(KIOSK_LABEL_LINK).toBe('shelter.psu.ac.th');
		expect(KIOSK_LABEL_TEXT.link.pt).toBeLessThan(KIOSK_LABEL_TEXT.checklist.pt);
		expect(layout.link.x).toBe(layout.text.x);
		expect(Math.abs(layout.link.y + half - layout.text.bottom)).toBeLessThanOrEqual(1);
	});

	it('leaves the text column at least its minimum width', () => {
		expect(layout.text.width).toBeGreaterThanOrEqual(mmToDots(KIOSK_LABEL_TEXT_MIN_WIDTH_MM) - 2);
	});
});

describe('QR sizing and layout beside the level bars', () => {
	const moduleCount = QRCode.create(SAMPLE_EVACUEE_ID, {}).modules.size;
	const { width } = kioskLabelDots();
	const padding = Math.round(mmToDots(KIOSK_LABEL_PADDING_MM));
	const gapDots = Math.round(mmToDots(KIOSK_LABEL_GAP_MM));

	it('leaves the QR box unchanged without a marker', () => {
		expect(kioskQrBoxMm()).toBeCloseTo(34.75, 6);
		expect(kioskQrBoxMm(null)).toBeCloseTo(34.75, 6);
		expect(kioskQrBoxMm(undefined)).toBeCloseTo(34.75, 6);
	});

	it('shrinks the QR box by the bars and their 2 mm gap: red 6 mm, yellow 3.5 mm', () => {
		expect(kioskQrBoxMm('red')).toBeCloseTo(34.75 - 6, 6);
		expect(kioskQrBoxMm('yellow')).toBeCloseTo(34.75 - 3.5, 6);
	});

	it('prints the version-3 QR at 33 / 29 / 24.8 mm (8 / 7 / 6 dots per module) for none / yellow / red', () => {
		expect(kioskQrPrintSize(moduleCount)).toMatchObject({ widthPx: 264, dotsPerModule: 8 });
		expect(kioskQrPrintSize(moduleCount, null)).toMatchObject({ widthPx: 264, dotsPerModule: 8 });
		expect(kioskQrPrintSize(moduleCount, 'yellow')).toMatchObject({
			widthPx: 231,
			margin: 2,
			dotsPerModule: 7
		});
		expect(kioskQrPrintSize(moduleCount, 'red')).toMatchObject({
			widthPx: 198,
			margin: 2,
			dotsPerModule: 6
		});
	});

	it.each([21, 25, 29, 33, 37])(
		'keeps %i-module codes inside the shrunk box, at least the minimum and with a 4-module quiet zone',
		(modules) => {
			for (const marker of ['red', 'yellow'] as const) {
				const size = kioskQrPrintSize(modules, marker);
				expect(size.sizeMm).toBeLessThanOrEqual(kioskQrBoxMm(marker));
				expect(dotsToMm(modules * size.dotsPerModule)).toBeGreaterThanOrEqual(KIOSK_QR_MIN_MM);
				// Image margin + the 2 mm gap to the bars.
				const quiet = size.margin + mmToDots(KIOSK_LABEL_BAND.gapMm) / size.dotsPerModule;
				expect(quiet).toBeGreaterThanOrEqual(KIOSK_QR_QUIET_ZONE_MODULES - 0.05);
			}
		}
	);

	it('lays out the QR exactly as before without a marker', () => {
		const px = kioskQrPrintSize(moduleCount).widthPx;
		expect(kioskLabelLayout(px, null)).toEqual(kioskLabelLayout(px));
		expect(kioskLabelLayout(px).qr.x).toBe(width - padding - px);
	});

	it.each(['red', 'yellow'] as const)(
		'puts the QR 2 mm (16 dots) left of the %s bars, text column and divider shifted with it',
		(marker) => {
			const px = kioskQrPrintSize(moduleCount, marker).widthPx;
			const layout = kioskLabelLayout(px, marker);
			const [firstBar] = kioskLabelBars(marker);

			expect(firstBar!.x - (layout.qr.x + px)).toBe(16);
			expect(layout.divider.x + layout.divider.width + gapDots).toBe(layout.qr.x);
			expect(layout.text.x + layout.text.width + gapDots).toBe(layout.divider.x);
			expect(layout.text.width).toBeGreaterThanOrEqual(mmToDots(KIOSK_LABEL_TEXT_MIN_WIDTH_MM) - 2);
		}
	);

	it('pins the final geometry in dots: red QR 198 at x 377, yellow QR 231 at x 364', () => {
		expect(kioskLabelLayout(198, 'red').qr.x).toBe(377);
		expect(kioskLabelLayout(231, 'yellow').qr.x).toBe(364);
	});
});

describe('kioskLabelBars', () => {
	const { width, height } = kioskLabelDots();
	const padding = Math.round(mmToDots(KIOSK_LABEL_PADDING_MM));

	it('gives red two vertical bars and yellow one', () => {
		expect(kioskLabelBars('red')).toHaveLength(2);
		expect(kioskLabelBars('yellow')).toHaveLength(1);
	});

	it.each(['red', 'yellow'] as const)(
		'ends the last %s bar at the right edge of the label padding',
		(marker) => {
			const last = kioskLabelBars(marker).at(-1)!;
			// 639 dots wide, 16 dots padding: the bar ends at x = 623.
			expect(last.x + last.width).toBe(width - padding);
			expect(last.x + last.width).toBe(623);
		}
	);

	it('makes every bar 1.5 mm (12 dots) wide', () => {
		for (const marker of ['red', 'yellow'] as const) {
			for (const bar of kioskLabelBars(marker)) expect(bar.width).toBe(12);
		}
	});

	it('puts the red bars 1 mm (8 dots) apart, left bar first', () => {
		const [left, right] = kioskLabelBars('red');
		expect(right!.x - (left!.x + left!.width)).toBe(8);
		expect(left!.x).toBe(591);
		expect(right!.x).toBe(611);
	});

	it.each(['red', 'yellow'] as const)(
		'spans the full inner height of the label, padding to padding, for %s',
		(marker) => {
			for (const bar of kioskLabelBars(marker)) {
				expect(bar.y).toBe(padding);
				expect(bar.y + bar.height).toBe(height - padding);
			}
		}
	);
});

describe('KIOSK_LABEL_CHECKLIST', () => {
	it('ships the ID card checklist in Thai with English in brackets', () => {
		expect(KIOSK_LABEL_CHECKLIST).toEqual([
			'เช็คอิน (Checked-in)',
			'คัดกรอง (Screened)',
			'ที่พัก (Stayed)'
		]);
	});

	it('ticks only check-in on a label printed at kiosk check-in', () => {
		expect(KIOSK_LABEL_CHECKLIST.slice(0, KIOSK_CHECK_IN_TICKS)).toEqual(['เช็คอิน (Checked-in)']);
	});
});

describe('labelZoneLine', () => {
	it('prints the assigned zone after the prefix', () => {
		expect(labelZoneLine('A3')).toEqual({ label: KIOSK_LABEL_ZONE_PREFIX, value: 'A3' });
	});

	it('trims the zone name', () => {
		expect(labelZoneLine('  โซนชาย ').value).toBe('โซนชาย');
	});

	it('leaves the zone blank to write by hand when none is assigned', () => {
		expect(labelZoneLine(null)).toEqual({ label: KIOSK_LABEL_ZONE_PREFIX, value: null });
		expect(labelZoneLine(undefined).value).toBeNull();
		expect(labelZoneLine('   ').value).toBeNull();
	});

	it('labels the row in English as on the field form', () => {
		expect(KIOSK_LABEL_ZONE_PREFIX).toBe('Zone:');
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

describe('wrapLabelName', () => {
	const measure = (text: string) => text.length;
	const words = (text: string) => text.split(/(?<= )/);

	it('puts each \\n-separated part on its own line even when both fit one line', () => {
		expect(wrapLabelName('สมชาย\nใจดี', 20, measure, 3, words)).toEqual(['สมชาย', 'ใจดี']);
	});

	it('keeps a single-line name on one line', () => {
		expect(wrapLabelName('สมชาย ใจดี', 20, measure, 3, words)).toEqual(['สมชาย ใจดี']);
	});

	it('wraps a part that is too wide within its own share of the lines', () => {
		expect(wrapLabelName('aa\nbb cc dd', 5, measure, 3, words)).toEqual(['aa', 'bb cc', 'dd']);
	});

	it('keeps the last name on the label when the first name overflows', () => {
		const lines = wrapLabelName('aaaaaaaaaaaaaaaaaaaa\nbbb', 5, measure, 3, words);
		expect(lines).toHaveLength(3);
		expect(lines[0]).toBe('aaaaa');
		expect(lines[1]).toMatch(/…$/);
		expect(lines[2]).toBe('bbb');
	});

	it('clips a long last name with an ellipsis once the first name has used its lines', () => {
		const lines = wrapLabelName('aa bb\ncc dd ee ff gg', 5, measure, 3, words);
		expect(lines).toEqual(['aa bb', 'cc dd', 'ee f…']);
	});

	it('gives the last name one line when maxLines is 2 and the first name is long', () => {
		expect(wrapLabelName('aa bb cc\ndd', 5, measure, 2, words)).toEqual(['aa b…', 'dd']);
	});

	it('ignores blank parts', () => {
		expect(wrapLabelName('\n  \nสมชาย\n', 20, measure, 3, words)).toEqual(['สมชาย']);
	});

	it('returns no lines for an empty name', () => {
		expect(wrapLabelName('', 20, measure, 3, words)).toEqual([]);
	});
});

describe('hashed person QR label (CR-233 AC-EQR-13)', () => {
	it('sizes the label the same for `evacuee:{ULID}@{hash6}` as for the legacy payload (same default ECC, 29 modules)', () => {
		const legacy = QRCode.create('evacuee:01K5Z8Q2J9M7X3V4B6N8C0D2EF', {}).modules.size;
		const hashed = QRCode.create('evacuee:01K5Z8Q2J9M7X3V4B6N8C0D2EF@683508', {}).modules.size;
		expect(hashed).toBe(29);
		expect(kioskQrPrintSize(hashed)).toEqual(kioskQrPrintSize(legacy));
	});
});
