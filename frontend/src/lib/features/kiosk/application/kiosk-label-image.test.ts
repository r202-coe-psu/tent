// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
		textAlign: '',
		textBaseline: '',
		imageSmoothingEnabled: true,
		fillRect: vi.fn(),
		drawImage: vi.fn(),
		measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
		getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
		putImageData: vi.fn(),
		fillText: vi.fn(() => {
			// `fillText` is synchronous — if any row's font wasn't `document.fonts.load()`-ed
			// (and awaited) before this call, the draw races the fetch (see kiosk-label-image.ts).
			if (fontsLoaded.length < 3) orderViolation = true;
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

	it('preloads a Thai-capable font for every text row before drawing any of them', async () => {
		await renderKioskLabelPng({
			qrSrc: 'data:image/png;base64,AA==',
			caption: 'ชื่อ',
			name: 'สมชาย ใจดี',
			detail: 'ศูนย์ SH001'
		});

		expect(harness.fontsLoaded).toHaveLength(3);
		for (const font of harness.fontsLoaded) {
			expect(font).toContain('IBM Plex Sans Thai');
		}
		expect(harness.isOrderViolated()).toBe(false);
	});

	it('draws every row with the Thai-capable font family, never the bare generic fallback', async () => {
		await renderKioskLabelPng({
			qrSrc: 'data:image/png;base64,AA==',
			caption: 'ชื่อ',
			name: 'สมชาย ใจดี',
			detail: 'ศูนย์ SH001'
		});

		expect(harness.fontsUsedInDrawing.length).toBeGreaterThan(0);
		for (const font of harness.fontsUsedInDrawing) {
			expect(font).toContain("'IBM Plex Sans Thai'");
		}
	});

	it('returns the rendered label as base64 PNG', async () => {
		const png = await renderKioskLabelPng({
			qrSrc: 'data:image/png;base64,AA==',
			caption: 'ชื่อ',
			name: 'สมชาย ใจดี',
			detail: 'ศูนย์ SH001'
		});
		expect(png).toBe('ZmFrZS1wbmc=');
	});
});
