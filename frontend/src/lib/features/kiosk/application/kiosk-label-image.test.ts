// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	KIOSK_LABEL_CHECKBOX,
	KIOSK_LABEL_CHECKLIST,
	KIOSK_LABEL_EMERGENCY_PREFIX,
	KIOSK_LABEL_LINK,
	KIOSK_LABEL_QR_CAPTION,
	KIOSK_LABEL_QR_CAPTION_GAP_MM,
	KIOSK_LABEL_ZONE,
	KIOSK_LABEL_ZONE_PREFIX,
	KIOSK_QR_MIN_MM,
	kioskLabelBandRects,
	kioskLabelLayout,
	mmToDots
} from '../domain/print-label';
import { renderKioskLabelPng } from './kiosk-label-image';

/** Width of the QR image `FakeImage` decodes to; the renderer sizes the layout from it. */
let fakeQrPx = 264;

class FakeImage {
	src = '';
	width = fakeQrPx;
	height = fakeQrPx;
	decode(): Promise<void> {
		return Promise.resolve();
	}
}

function installFakeCanvas() {
	const fontsLoaded: string[] = [];
	const fontsUsedInDrawing: string[] = [];
	let orderViolation = false;
	/** `fillStyle` at the moment of each draw, parallel to the matching spy's `mock.calls`. */
	const fillRectStyles: string[] = [];
	const fillTextStyles: string[] = [];
	/** `font` at the moment of each `fillText`, parallel to its `mock.calls`. */
	const fillTextFonts: string[] = [];
	/** `strokeStyle` and `lineWidth` at the moment of each `strokeRect`. */
	const strokeRectStyles: { style: string; lineWidth: number }[] = [];

	const fakeContext = {
		fillStyle: '',
		letterSpacing: '0px',
		textAlign: '',
		textBaseline: '',
		imageSmoothingEnabled: true,
		strokeStyle: '',
		lineWidth: 1,
		lineCap: '',
		lineJoin: '',
		fillRect: vi.fn<(x: number, y: number, w: number, h: number) => void>(() => {
			fillRectStyles.push(fakeContext.fillStyle);
		}),
		strokeRect: vi.fn<(x: number, y: number, w: number, h: number) => void>(() => {
			strokeRectStyles.push({ style: fakeContext.strokeStyle, lineWidth: fakeContext.lineWidth });
		}),
		closePath: vi.fn(),
		drawImage: vi.fn(),
		beginPath: vi.fn(),
		moveTo: vi.fn(),
		lineTo: vi.fn(),
		stroke: vi.fn(),
		measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
		getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
		putImageData: vi.fn(),
		fillText: vi.fn<(text: string) => void>(() => {
			fillTextStyles.push(fakeContext.fillStyle);
			fillTextFonts.push(fontsUsedInDrawing.at(-1) ?? '');
			// `fillText` is synchronous — if any row's font wasn't `document.fonts.load()`-ed
			// (and awaited) before this call, the draw races the fetch (see kiosk-label-image.ts).
			if (fontsLoaded.length < 4) orderViolation = true;
		})
	};
	Object.defineProperty(fakeContext, 'font', {
		configurable: true,
		set(value: string) {
			fontsUsedInDrawing.push(value);
		},
		get() {
			return fontsUsedInDrawing.at(-1) ?? '';
		}
	});

	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
		fakeContext as unknown as CanvasRenderingContext2D
	);
	vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
		'data:image/png;base64,ZmFrZS1wbmc='
	);
	vi.stubGlobal('Image', FakeImage);
	Object.defineProperty(document, 'fonts', {
		configurable: true,
		value: {
			ready: Promise.resolve(),
			load: vi.fn((font: string) => {
				fontsLoaded.push(font);
				// A matched face, as the browser returns once the web font is available.
				return Promise.resolve([{ family: 'IBM Plex Sans Thai Looped' }]);
			})
		}
	});

	return {
		fontsLoaded,
		fontsUsedInDrawing,
		isOrderViolated: () => orderViolation,
		fakeContext,
		fillRectStyles,
		fillTextStyles,
		fillTextFonts,
		strokeRectStyles
	};
}

describe('renderKioskLabelPng', () => {
	let harness: ReturnType<typeof installFakeCanvas>;

	beforeEach(() => {
		harness = installFakeCanvas();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	const label = {
		qrSrc: 'data:image/png;base64,AA==',
		name: 'สมชาย ใจดี'
	};

	it('preloads every row font before drawing any of them', async () => {
		await renderKioskLabelPng(label);

		expect(harness.fontsLoaded).toHaveLength(4);
		expect(harness.isOrderViolated()).toBe(false);
	});

	it('asks the font loader for the Thai subset too, not only the Latin one', async () => {
		await renderKioskLabelPng(label);

		// Web fonts split by unicode-range: `load(font)` alone checks a space and fetches only the
		// Latin file, so Thai would draw in the fallback face until the UI happened to use it.
		const calls = vi.mocked(document.fonts.load).mock.calls;
		expect(calls.length).toBeGreaterThan(0);
		for (const [, text] of calls) {
			expect(text).toMatch(/[\u0E00-\u0E7F]/);
			expect(text).toMatch(/[A-Za-z0-9]/);
		}
	});

	it('draws every row with the Thai-capable family, and no phone number', async () => {
		await renderKioskLabelPng(label);

		expect(harness.fontsUsedInDrawing.length).toBeGreaterThan(0);
		for (const font of harness.fontsUsedInDrawing) {
			// Same face as the web page around the preview, so the label matches the app.
			expect(font).toMatch(/px 'IBM Plex Sans Thai Looped', 'IBM Plex Sans Thai'/);
		}
		const texts = harness.fakeContext.fillText.mock.calls.map(([text]) => text);
		expect(texts).toEqual([
			'สมชาย ใจดี',
			KIOSK_LABEL_ZONE_PREFIX,
			'เช็คอิน (Checked-in)',
			'คัดกรอง (Screened)',
			'ที่พัก (Stayed)',
			KIOSK_LABEL_LINK,
			...KIOSK_LABEL_QR_CAPTION
		]);
	});

	it('draws and preloads the name at 12 pt bold', async () => {
		await renderKioskLabelPng(label);

		// 12 pt at 203 dpi = 33.8333... printer dots.
		const nameAt = harness.fakeContext.fillText.mock.calls.findIndex(
			([text]) => text === label.name
		);
		expect(harness.fillTextFonts[nameAt]).toMatch(/^700 33\.83\d*px /);
		expect(harness.fontsLoaded).toContain(harness.fillTextFonts[nameAt]);
	});

	it('draws the first and last name on separate rows', async () => {
		await renderKioskLabelPng({ ...label, name: 'สมชาย\nใจดี' });

		const texts = harness.fakeContext.fillText.mock.calls.map(([text]) => text);
		expect(texts.slice(0, 3)).toEqual(['สมชาย', 'ใจดี', KIOSK_LABEL_ZONE_PREFIX]);
		const ys = harness.fakeContext.fillText.mock.calls.map(
			(call) => (call as unknown as [string, number, number])[2]
		);
		expect(ys[1]).toBeGreaterThan(ys[0]!);
	});

	it('keeps the last name on the label when the first name is too long for one row', async () => {
		const first = 'ก'.repeat(120);
		await renderKioskLabelPng({ ...label, name: `${first}\nใจดี` });

		const texts = harness.fakeContext.fillText.mock.calls.map(([text]) => text);
		const zoneAt = texts.indexOf(KIOSK_LABEL_ZONE_PREFIX);
		expect(zoneAt).toBeLessThanOrEqual(3);
		expect(texts[zoneAt - 1]).toBe('ใจดี');
	});

	it('draws a single-line name on one row', async () => {
		await renderKioskLabelPng({ ...label, name: 'สมชาย' });

		const texts = harness.fakeContext.fillText.mock.calls.map(([text]) => text);
		expect(texts.slice(0, 2)).toEqual(['สมชาย', KIOSK_LABEL_ZONE_PREFIX]);
	});

	it('prints the emergency contact phone on its own row under the zone', async () => {
		await renderKioskLabelPng({ ...label, emergencyPhone: '0891234567' });

		const texts = harness.fakeContext.fillText.mock.calls.map(([text]) => text);
		const zoneAt = texts.indexOf(KIOSK_LABEL_ZONE_PREFIX);
		expect(texts.slice(zoneAt + 1, zoneAt + 3)).toEqual([
			KIOSK_LABEL_EMERGENCY_PREFIX,
			'0891234567'
		]);
		const ys = harness.fakeContext.fillText.mock.calls.map(
			(call) => (call as unknown as [string, number, number])[2]
		);
		const firstCheckRow = texts.indexOf(KIOSK_LABEL_CHECKLIST[0]);
		expect(ys[zoneAt + 1]).toBeGreaterThan(ys[zoneAt]!);
		expect(ys[zoneAt + 1]).toBeLessThan(ys[firstCheckRow]!);
	});

	it('leaves no emergency row when there is no emergency phone', async () => {
		await renderKioskLabelPng({ ...label, emergencyPhone: null });

		const texts = harness.fakeContext.fillText.mock.calls.map(([text]) => text);
		expect(texts).not.toContain(KIOSK_LABEL_EMERGENCY_PREFIX);
	});

	it('prints the "shelter use only" caption centred under the QR, clear of its quiet zone', async () => {
		await renderKioskLabelPng(label);

		const { qr } = kioskLabelLayout(264);
		const rows = harness.fakeContext.fillText.mock.calls.filter(([text]) =>
			(KIOSK_LABEL_QR_CAPTION as readonly string[]).includes(text)
		) as unknown as [string, number, number][];
		expect(rows.map(([text]) => text)).toEqual([...KIOSK_LABEL_QR_CAPTION]);
		for (const [text, x] of rows) {
			// The fake measureText is 6 dots per character.
			expect(x + (text.length * 6) / 2).toBeCloseTo(qr.x + 264 / 2, 5);
		}
		const [first, second] = rows.map(([, , y]) => y);
		expect(first).toBeGreaterThan(qr.y + 264 + mmToDots(KIOSK_LABEL_QR_CAPTION_GAP_MM));
		expect(second).toBeGreaterThan(first!);
		expect(second).toBeLessThan(479 - mmToDots(2));
	});

	it('draws the link left-aligned at the bottom of the text column', async () => {
		const aligns: string[] = [];
		let align = '';
		Object.defineProperty(harness.fakeContext, 'textAlign', {
			configurable: true,
			set(value: string) {
				align = value;
				aligns.push(value);
			},
			get: () => align
		});

		await renderKioskLabelPng(label);

		const { link, text } = kioskLabelLayout(264);
		expect(harness.fakeContext.fillText).toHaveBeenCalledWith(
			KIOSK_LABEL_LINK,
			link.x,
			link.y,
			text.width
		);
		expect(aligns).not.toContain('center');
	});

	it('puts each checklist item on its own row, boxes aligned at the column edge', async () => {
		await renderKioskLabelPng(label);

		const rows = harness.fakeContext.fillText.mock.calls.filter(([text]) =>
			['เช็คอิน (Checked-in)', 'คัดกรอง (Screened)', 'ที่พัก (Stayed)'].includes(text)
		) as unknown as [string, number, number][];
		expect(rows.map(([text]) => text)).toEqual([
			'เช็คอิน (Checked-in)',
			'คัดกรอง (Screened)',
			'ที่พัก (Stayed)'
		]);
		expect(new Set(rows.map(([, x]) => x)).size).toBe(1);
		const ys = rows.map(([, , y]) => y);
		expect(ys[0]).toBeLessThan(ys[1]!);
		expect(ys[1]).toBeLessThan(ys[2]!);
		expect(ys[2]).toBeLessThan(kioskLabelLayout(264).link.y);
	});

	describe('station ticks', () => {
		it('leaves every checklist box empty by default', async () => {
			await renderKioskLabelPng(label);

			expect(harness.fakeContext.stroke).not.toHaveBeenCalled();
		});

		it('ticks the first boxes, one per station passed', async () => {
			await renderKioskLabelPng({ ...label, checkedCount: 2 });

			expect(harness.fakeContext.stroke).toHaveBeenCalledTimes(2);
			// Each tick starts inside its own box, top row first.
			const starts = harness.fakeContext.moveTo.mock.calls.map(([, y]) => y as number);
			const rows = harness.fakeContext.fillText.mock.calls
				.filter(([text]) => ['เช็คอิน (Checked-in)', 'คัดกรอง (Screened)'].includes(text))
				.map((call) => (call as unknown as [string, number, number])[2]);
			const boxSize = Math.round(mmToDots(KIOSK_LABEL_CHECKBOX.sizeMm));
			starts.forEach((y, index) => expect(Math.abs(y - rows[index]!)).toBeLessThan(boxSize / 2));
		});

		it('ticks all three boxes after the last station', async () => {
			await renderKioskLabelPng({ ...label, checkedCount: 3 });

			expect(harness.fakeContext.stroke).toHaveBeenCalledTimes(3);
		});
	});

	describe('zone row', () => {
		const dot = Math.round(mmToDots(KIOSK_LABEL_ZONE.dotMm));
		const ruleDots = () =>
			harness.fakeContext.fillRect.mock.calls.filter(([, , w, h]) => w === dot && h === dot);
		const texts = () => harness.fakeContext.fillText.mock.calls.map(([text]) => text);

		it('leaves a dotted rule to write the zone on when none is assigned', async () => {
			await renderKioskLabelPng({ ...label, zone: null });

			expect(texts()).toContain(KIOSK_LABEL_ZONE_PREFIX);
			expect(ruleDots().length).toBeGreaterThan(10);
			// The rule stays inside the text column, left of the divider.
			const column = kioskLabelLayout(264).text;
			for (const [x] of ruleDots()) {
				expect(x + dot).toBeLessThanOrEqual(column.x + column.width);
			}
		});

		it('prints the assigned zone after the prefix instead of the rule', async () => {
			await renderKioskLabelPng({ ...label, zone: 'A3' });

			const drawn = texts();
			expect(
				drawn.slice(drawn.indexOf(KIOSK_LABEL_ZONE_PREFIX), drawn.indexOf(KIOSK_LABEL_CHECKLIST[0]))
			).toEqual([KIOSK_LABEL_ZONE_PREFIX, 'A3']);
			expect(ruleDots()).toEqual([]);
		});

		it('cuts a zone name too long for the column to one line with an ellipsis', async () => {
			await renderKioskLabelPng({ ...label, zone: 'โซน'.repeat(40) });

			const value = texts()[texts().indexOf(KIOSK_LABEL_ZONE_PREFIX) + 1];
			expect(value).toMatch(/…$/);
			expect(value!.length).toBeLessThan(120);
		});
	});

	describe('vulnerability marker', () => {
		const lower = (style: string) => style.toLowerCase();
		const textCalls = () =>
			harness.fakeContext.fillText.mock.calls as unknown as [string, number, number][];
		const fillRects = () =>
			harness.fakeContext.fillRect.mock.calls.map(([x, y, w, h], index) => ({
				x,
				y,
				w,
				h,
				style: lower(harness.fillRectStyles[index]!)
			}));
		const RED_TEXT = 'แดง · ดูแลเร่งด่วน';
		const YELLOW_TEXT = 'เหลือง · ดูแลพิเศษ';
		// The level bars above the QR are separate, QR-wide elements (see 'level bars above the QR').
		const BAR_WIDTH = 264;
		// 9 pt row: 9/72 in * 203 dpi * 1.3 line height = 33 dots.
		const ROW_DOTS = 33;

		it('draws a red marker row as plain black text with its meaning, with no band behind it', async () => {
			await renderKioskLabelPng({ ...label, marker: 'red' });

			const wordAt = textCalls().findIndex(([text]) => text === RED_TEXT);
			expect(wordAt).toBeGreaterThanOrEqual(0);
			expect(lower(harness.fillTextStyles[wordAt]!)).toBe('#000000');
			// No white ink for text anywhere: the marker row is plain black on white.
			const whiteTexts = textCalls()
				.filter((_, index) => lower(harness.fillTextStyles[index]!) === '#ffffff')
				.map(([text]) => text);
			expect(whiteTexts).toEqual([]);
			// No black band behind the marker row: the only wide black boxes are the QR-wide bars.
			expect(
				fillRects().filter((r) => r.w > 100 && r.w !== BAR_WIDTH && r.style === '#000000')
			).toEqual([]);
			// The marker sits above the name.
			const nameY = textCalls().find(([text]) => text === label.name)![2];
			expect(textCalls()[wordAt]![2]).toBeLessThan(nameY);
		});

		it('draws a filled black square left of the red text so red reads as "■ แดง · ดูแลเร่งด่วน"', async () => {
			await renderKioskLabelPng({ ...label, marker: 'red' });

			const column = kioskLabelLayout(264).text;
			const word = textCalls().find(([text]) => text === RED_TEXT)!;
			const nameY = textCalls().find(([text]) => text === label.name)![2];
			const squares = fillRects().filter(
				(r) =>
					r.style === '#000000' &&
					r.w >= 10 &&
					r.w < 100 &&
					Math.abs(r.w - r.h) <= 1 &&
					r.y + r.h <= nameY
			);
			expect(squares).toHaveLength(1);
			const square = squares[0]!;
			expect(square.x).toBeGreaterThanOrEqual(column.x);
			expect(square.x + square.w).toBeLessThan(word[1]);
			// Smaller than the 33-dot row, vertically inside the marker row.
			expect(square.h).toBeLessThan(ROW_DOTS);
			expect(square.y).toBeLessThanOrEqual(word[2]);
			expect(square.y + square.h).toBeGreaterThanOrEqual(word[2]);
		});

		it('sits the glyph 1 dot above its centred position while the words stay centred on the row', async () => {
			await renderKioskLabelPng({ ...label, marker: 'red' });

			const rowTop = kioskLabelLayout(264).text.y;
			const word = textCalls().find(([text]) => text === RED_TEXT)!;
			// Words keep the row middle: 33-dot row.
			expect(word[2]).toBeCloseTo(rowTop + ROW_DOTS / 2, 5);
			const nameY = textCalls().find(([text]) => text === label.name)![2];
			const square = fillRects().find(
				(r) => r.style === '#000000' && r.w >= 10 && r.w < 100 && r.y + r.h <= nameY
			)!;
			// A 20-dot square (0.6 of the row) centred on the row middle would start at row middle - 10
			// (rounded to 7 + rowTop); the glyph is raised 1 dot above that.
			expect(square.h).toBe(20);
			expect(square.y).toBe(Math.round(rowTop + ROW_DOTS / 2 - 10) - 1);
		});

		it('raises the yellow triangle by the same 1 dot as the red square', async () => {
			await renderKioskLabelPng({ ...label, marker: 'red' });
			const nameY = textCalls().find(([text]) => text === label.name)![2];
			const square = fillRects().find(
				(r) => r.style === '#000000' && r.w >= 10 && r.w < 100 && r.y + r.h <= nameY
			)!;
			const squareMiddle = square.y + square.h / 2;

			harness.fakeContext.moveTo.mockClear();
			harness.fakeContext.lineTo.mockClear();
			await renderKioskLabelPng({ ...label, marker: 'yellow' });

			const ys = [
				...harness.fakeContext.moveTo.mock.calls,
				...harness.fakeContext.lineTo.mock.calls
			].map(([, y]) => y as number);
			expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(squareMiddle, 5);
		});

		it('draws a yellow marker row as black text with its meaning beside a hollow triangle, with no outline or band behind it', async () => {
			await renderKioskLabelPng({ ...label, marker: 'yellow' });

			const wordAt = textCalls().findIndex(([text]) => text === YELLOW_TEXT);
			expect(wordAt).toBeGreaterThanOrEqual(0);
			expect(lower(harness.fillTextStyles[wordAt]!)).toBe('#000000');
			expect(textCalls().some(([text]) => text.includes('แดง'))).toBe(false);

			// No outline anywhere: not around the marker row, and the level bars are filled.
			expect(harness.fakeContext.strokeRect).not.toHaveBeenCalled();
			expect(
				fillRects().filter((r) => r.w > 100 && r.w !== BAR_WIDTH && r.style === '#000000')
			).toEqual([]);

			// The triangle is a stroked three-point path, left of the word.
			expect(harness.fakeContext.stroke).toHaveBeenCalledTimes(1);
			expect(harness.fakeContext.moveTo).toHaveBeenCalledTimes(1);
			expect(harness.fakeContext.lineTo.mock.calls.length).toBeGreaterThanOrEqual(2);
			const triangleXs = [
				...harness.fakeContext.moveTo.mock.calls,
				...harness.fakeContext.lineTo.mock.calls
			].map(([x]) => x as number);
			expect(Math.max(...triangleXs)).toBeLessThan(textCalls()[wordAt]![1]);
		});

		it.each([
			['red', RED_TEXT],
			['yellow', YELLOW_TEXT]
		] as const)(
			'prints the %s marker in the emergency row face (9 pt, not bold) with no extra font load',
			async (marker, text) => {
				await renderKioskLabelPng({ ...label, marker });

				const wordAt = textCalls().findIndex(([t]) => t === text);
				const checkAt = textCalls().findIndex(([t]) => t === KIOSK_LABEL_CHECKLIST[0]);
				expect(harness.fillTextFonts[wordAt]).toBe(harness.fillTextFonts[checkAt]);
				expect(harness.fillTextFonts[wordAt]).toMatch(/^500 25\.375px /);
				expect(harness.fontsLoaded).toHaveLength(4);
			}
		);

		it.each(['red', 'yellow'] as const)(
			'pushes the name and the rows after it down by the 9 pt row below the %s marker',
			async (marker) => {
				await renderKioskLabelPng(label);
				const plainYs = textCalls().map(([, , y]) => y);
				harness.fakeContext.fillText.mockClear();

				await renderKioskLabelPng({ ...label, marker });

				const markedYs = textCalls()
					.filter(([text]) => ![RED_TEXT, YELLOW_TEXT].includes(text))
					.map(([, , y]) => y);
				const nameAt = 0;
				const shift = ROW_DOTS + mmToDots(1);
				expect(markedYs[nameAt]! - plainYs[nameAt]!).toBeCloseTo(shift, 5);
				// Zone row follows the name, so it moves down with it.
				expect(markedYs[1]! - plainYs[1]!).toBeCloseTo(shift, 5);
				// The bottom-anchored checklist and link stay put.
				expect(markedYs.slice(2)).toEqual(plainYs.slice(2));
			}
		);

		it.each([
			['red', RED_TEXT],
			['yellow', YELLOW_TEXT]
		] as const)(
			'keeps the %s marker inside the text column, left of the divider',
			async (marker, text) => {
				await renderKioskLabelPng({ ...label, marker });

				const { divider, text: column } = kioskLabelLayout(264);
				const word = harness.fakeContext.fillText.mock.calls.find(
					([t]) => t === text
				) as unknown as [string, number, number, number];
				// The word is squeezed to the room left in the column, never into the divider.
				expect(word[1]).toBeGreaterThanOrEqual(column.x);
				expect(word[1] + word[3]).toBeLessThanOrEqual(divider.x);
			}
		);

		it.each([undefined, null])(
			'draws no marker words or shapes when the marker is %s',
			async (marker) => {
				await renderKioskLabelPng({ ...label, marker });

				const words = textCalls().map(([text]) => text);
				expect(words).not.toContain(RED_TEXT);
				expect(words).not.toContain(YELLOW_TEXT);
				expect(harness.fakeContext.strokeRect).not.toHaveBeenCalled();
				expect(harness.fakeContext.stroke).not.toHaveBeenCalled();
			}
		);
	});

	describe('level band at the left edge', () => {
		const lower = (style: string) => style.toLowerCase();
		const textCalls = () =>
			harness.fakeContext.fillText.mock.calls as unknown as [string, number, number, number?][];
		const fillRects = () =>
			harness.fakeContext.fillRect.mock.calls.map(([x, y, w, h], index) => ({
				x,
				y,
				w,
				h,
				style: lower(harness.fillRectStyles[index]!)
			}));
		const asBox = ({ x, y, w, h }: { x: number; y: number; w: number; h: number }) => ({
			x,
			y,
			width: w,
			height: h
		});
		/** Black boxes inside the band's 32-dot column at the left padding. */
		const bandRects = () =>
			fillRects().filter((r) => r.style === '#000000' && r.x >= 16 && r.x + r.w <= 48);

		afterEach(() => {
			fakeQrPx = 264;
		});

		it('draws red as one solid black band, 32 dots wide, padding to padding', async () => {
			fakeQrPx = 198;
			await renderKioskLabelPng({ ...label, marker: 'red' });

			expect(bandRects().map(asBox)).toEqual([{ x: 16, y: 16, width: 32, height: 447 }]);
		});

		it('draws yellow as two rails with the diagonal stripes between them', async () => {
			fakeQrPx = 198;
			await renderKioskLabelPng({ ...label, marker: 'yellow' });

			expect(bandRects().map(asBox)).toEqual(kioskLabelBandRects('yellow'));
		});

		it.each(['red', 'yellow'] as const)(
			'starts the %s label text 2 mm (16 dots) right of the band and keeps the QR at the padding',
			async (marker) => {
				fakeQrPx = 198;
				await renderKioskLabelPng({ ...label, marker });

				const [, x] = harness.fakeContext.drawImage.mock.calls[0]!;
				// 639 label width - 16 padding - 198 QR.
				expect(x).toBe(425);
				const nameX = textCalls().find(([text]) => text === label.name)![1];
				expect(nameX).toBe(64);
				expect(fakeQrPx).toBeGreaterThanOrEqual(mmToDots(KIOSK_QR_MIN_MM));
			}
		);

		it.each(['red', 'yellow'] as const)(
			'draws the %s band with no words, no outline and no white text',
			async (marker) => {
				fakeQrPx = 198;
				await renderKioskLabelPng({ ...label, marker });

				const words = textCalls().map(([text]) => text);
				expect(words).not.toContain('ดูแลเร่งด่วน');
				expect(words).not.toContain('ดูแลพิเศษ');
				expect(harness.fakeContext.strokeRect).not.toHaveBeenCalled();
				const whiteTexts = textCalls().filter(
					(_, index) => lower(harness.fillTextStyles[index]!) === '#ffffff'
				);
				expect(whiteTexts).toEqual([]);
				expect(harness.fontsLoaded).toHaveLength(4);
			}
		);

		it.each([undefined, null])(
			'draws no band and keeps the layout where it was when the marker is %s',
			async (marker) => {
				await renderKioskLabelPng({ ...label, marker });

				// Nothing full-height at the left padding (the checkboxes there are short).
				expect(bandRects().filter((r) => r.h === 447)).toEqual([]);
				expect(harness.fakeContext.strokeRect).not.toHaveBeenCalled();
				const [, x] = harness.fakeContext.drawImage.mock.calls[0]!;
				// 639 label width - 16 padding - 264 QR.
				expect(x).toBe(359);
			}
		);
	});

	it('returns the rendered label as base64 PNG', async () => {
		expect(await renderKioskLabelPng(label)).toBe('ZmFrZS1wbmc=');
	});

	describe('when the Thai label font cannot be loaded', () => {
		it('rejects instead of drawing with a fallback font when the load fails', async () => {
			vi.mocked(document.fonts.load).mockRejectedValue(new Error('network down'));

			await expect(renderKioskLabelPng(label)).rejects.toThrow('network down');
			expect(harness.fakeContext.fillText).not.toHaveBeenCalled();
		});

		it('rejects when no font face matches (load resolves an empty list)', async () => {
			vi.mocked(document.fonts.load).mockResolvedValue([]);

			await expect(renderKioskLabelPng(label)).rejects.toThrow(/font/i);
			expect(harness.fakeContext.fillText).not.toHaveBeenCalled();
		});

		it('tries the font again on the next render instead of caching the failure', async () => {
			vi.mocked(document.fonts.load).mockResolvedValueOnce([]);
			await expect(renderKioskLabelPng(label)).rejects.toThrow(/font/i);

			vi.mocked(document.fonts.load).mockResolvedValue([
				{ family: 'IBM Plex Sans Thai Looped' } as unknown as FontFace
			]);
			expect(await renderKioskLabelPng(label)).toBe('ZmFrZS1wbmc=');
		});
	});
});
