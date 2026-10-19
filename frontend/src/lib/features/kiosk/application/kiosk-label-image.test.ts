// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	KIOSK_LABEL_CHECKBOX,
	KIOSK_LABEL_LINK,
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
		fillRect: vi.fn(),
		drawImage: vi.fn(),
		beginPath: vi.fn(),
		moveTo: vi.fn(),
		lineTo: vi.fn(),
		stroke: vi.fn(),
		measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
		getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
		putImageData: vi.fn(),
		fillText: vi.fn<(text: string) => void>(() => {
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
				return Promise.resolve([]);
			})
		}
	});

	return { fontsLoaded, fontsUsedInDrawing, isOrderViolated: () => orderViolation, fakeContext };
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

	it('draws every row with the Thai-capable family, and no phone number', async () => {
		await renderKioskLabelPng(label);

		expect(harness.fontsUsedInDrawing.length).toBeGreaterThan(0);
		for (const font of harness.fontsUsedInDrawing) {
			expect(font).toMatch(/'IBM Plex Sans Thai'/);
		}
		const texts = harness.fakeContext.fillText.mock.calls.map(([text]) => text);
		expect(texts).toEqual([
			'สมชาย ใจดี',
			KIOSK_LABEL_ZONE_PREFIX,
			'เช็คอิน',
			'คัดกรอง',
			'ที่พัก',
			KIOSK_LABEL_LINK
		]);
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
			['เช็คอิน', 'คัดกรอง', 'ที่พัก'].includes(text)
		) as unknown as [string, number, number][];
		expect(rows.map(([text]) => text)).toEqual(['เช็คอิน', 'คัดกรอง', 'ที่พัก']);
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
				.filter(([text]) => ['เช็คอิน', 'คัดกรอง'].includes(text))
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
			expect(drawn.slice(drawn.indexOf(KIOSK_LABEL_ZONE_PREFIX), -4)).toEqual([
				KIOSK_LABEL_ZONE_PREFIX,
				'A3'
			]);
			expect(ruleDots()).toEqual([]);
		});

		it('cuts a zone name too long for the column to one line with an ellipsis', async () => {
			await renderKioskLabelPng({ ...label, zone: 'โซน'.repeat(40) });

			const value = texts()[texts().indexOf(KIOSK_LABEL_ZONE_PREFIX) + 1];
			expect(value).toMatch(/…$/);
			expect(value!.length).toBeLessThan(120);
		});
	});

	it('returns the rendered label as base64 PNG', async () => {
		expect(await renderKioskLabelPng(label)).toBe('ZmFrZS1wbmc=');
	});
});
