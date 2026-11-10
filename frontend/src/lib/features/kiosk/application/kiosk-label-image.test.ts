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
	kioskLabelLayout,
	mmToDots
} from '../domain/print-label';
import { renderKioskLabelPng } from './kiosk-label-image';

class FakeImage {
	src = '';
	width = 264;
	height = 264;
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
		strokeRect: vi.fn<(x: number, y: number, w: number, h: number) => void>(),
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
		fillTextStyles
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

		it('draws a red marker as a white word on a black band at the top of the text column', async () => {
			await renderKioskLabelPng({ ...label, marker: 'red' });

			const column = kioskLabelLayout(264).text;
			const wordAt = textCalls().findIndex(([text]) => text.includes('แดง'));
			expect(wordAt).toBeGreaterThanOrEqual(0);
			expect(lower(harness.fillTextStyles[wordAt]!)).toBe('#ffffff');

			const [, , wordY] = textCalls()[wordAt]!;
			const bands = harness.fakeContext.fillRect.mock.calls.filter(
				([x, y, w, h], index) =>
					lower(harness.fillRectStyles[index]!) === '#000000' &&
					x >= column.x &&
					x + w <= column.x + column.width &&
					y <= wordY &&
					wordY <= y + h &&
					w > 100
			);
			expect(bands).toHaveLength(1);
			// The band sits above the name.
			const nameY = textCalls().find(([text]) => text === label.name)![2];
			expect(bands[0]![1] + bands[0]![3]).toBeLessThanOrEqual(nameY);
		});

		it('draws a white filled square inside the red band, left of the word, so red reads as "■ แดง"', async () => {
			await renderKioskLabelPng({ ...label, marker: 'red' });

			const rects = harness.fakeContext.fillRect.mock.calls;
			const band = rects.find(
				([, , w], i) => w > 100 && lower(harness.fillRectStyles[i]!) === '#000000'
			)!;
			const [bandX, bandY, bandW, bandH] = band;
			const word = textCalls().find(([text]) => text.includes('แดง'))!;

			const squares = rects.filter(
				([x, y, w, h], i) =>
					lower(harness.fillRectStyles[i]!) === '#ffffff' &&
					w <= 100 &&
					Math.abs(w - h) <= 1 &&
					x >= bandX &&
					x + w <= bandX + bandW &&
					y >= bandY &&
					y + h <= bandY + bandH
			);
			expect(squares).toHaveLength(1);
			const [squareX, , squareW] = squares[0]!;
			expect(squareW).toBeGreaterThan(0);
			expect(squareX + squareW).toBeLessThan(word[1]);
		});

		it('draws a yellow marker as black text beside a hollow triangle in an outline, with no filled band', async () => {
			await renderKioskLabelPng({ ...label, marker: 'yellow' });

			const column = kioskLabelLayout(264).text;
			const wordAt = textCalls().findIndex(([text]) => text.includes('เหลือง'));
			expect(wordAt).toBeGreaterThanOrEqual(0);
			expect(lower(harness.fillTextStyles[wordAt]!)).toBe('#000000');
			expect(textCalls().some(([text]) => text.includes('แดง'))).toBe(false);

			// An outline rect in the text column, not a filled band.
			const outlines = harness.fakeContext.strokeRect.mock.calls;
			expect(outlines).toHaveLength(1);
			const [outlineX, , outlineW] = outlines[0]!;
			expect(outlineX).toBeGreaterThanOrEqual(column.x);
			expect(outlineX + outlineW).toBeLessThanOrEqual(column.x + column.width);
			const bands = harness.fakeContext.fillRect.mock.calls.filter(([, , w]) => w > 100);
			expect(bands).toHaveLength(1); // only the white page background, no black band
			expect(
				lower(harness.fillRectStyles[harness.fakeContext.fillRect.mock.calls.indexOf(bands[0]!)]!)
			).toBe('#ffffff');

			// The triangle is a stroked three-point path inside the outline, left of the word.
			expect(harness.fakeContext.stroke).toHaveBeenCalledTimes(1);
			expect(harness.fakeContext.moveTo).toHaveBeenCalledTimes(1);
			expect(harness.fakeContext.lineTo.mock.calls.length).toBeGreaterThanOrEqual(2);
			const triangleXs = [
				...harness.fakeContext.moveTo.mock.calls,
				...harness.fakeContext.lineTo.mock.calls
			].map(([x]) => x as number);
			expect(Math.max(...triangleXs)).toBeLessThan(textCalls()[wordAt]![1]);
		});

		it.each(['red', 'yellow'] as const)(
			'pushes the name and the rows after it down below the %s marker',
			async (marker) => {
				await renderKioskLabelPng(label);
				const plainYs = textCalls().map(([, , y]) => y);
				harness.fakeContext.fillText.mockClear();

				await renderKioskLabelPng({ ...label, marker });

				const markedYs = textCalls()
					.filter(([text]) => !['แดง', 'เหลือง'].includes(text))
					.map(([, , y]) => y);
				const nameAt = 0;
				expect(markedYs[nameAt]).toBeGreaterThan(plainYs[nameAt]!);
				// Zone row follows the name, so it moves down with it.
				expect(markedYs[1]).toBeGreaterThan(plainYs[1]!);
				// The bottom-anchored checklist and link stay put.
				expect(markedYs.slice(2)).toEqual(plainYs.slice(2));
			}
		);

		it.each(['red', 'yellow'] as const)(
			'keeps the %s marker inside the text column, left of the divider',
			async (marker) => {
				await renderKioskLabelPng({ ...label, marker });

				const { divider, text } = kioskLabelLayout(264);
				const rects = [
					...harness.fakeContext.fillRect.mock.calls.filter(([, , w]) => w > 100 && w < 639),
					...harness.fakeContext.strokeRect.mock.calls
				];
				expect(rects.length).toBeGreaterThan(0);
				for (const [x, , w] of rects) {
					expect(x).toBeGreaterThanOrEqual(text.x);
					expect(x + w).toBeLessThanOrEqual(divider.x);
				}
			}
		);

		it.each([undefined, null])(
			'draws no marker words or shapes when the marker is %s',
			async (marker) => {
				await renderKioskLabelPng({ ...label, marker });

				const words = textCalls().map(([text]) => text);
				expect(words).not.toContain('แดง');
				expect(words).not.toContain('เหลือง');
				expect(harness.fakeContext.strokeRect).not.toHaveBeenCalled();
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
