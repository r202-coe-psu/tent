// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KIOSK_LABEL_LINK } from '../domain/print-label';
import { volunteerLabelLayout } from '../domain/volunteer-label';
import { renderVolunteerLabelPng } from './volunteer-label-image';

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
	let orderViolation = false;
	let align = '';

	const fakeContext = {
		fillStyle: '',
		font: '',
		letterSpacing: '0px',
		textBaseline: '',
		imageSmoothingEnabled: true,
		fillRect: vi.fn(),
		drawImage: vi.fn(),
		measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
		getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
		putImageData: vi.fn(),
		fillText: vi.fn<(text: string, x: number, y: number) => void>(() => {
			// `fillText` is synchronous — if any row's font wasn't `document.fonts.load()`-ed
			// (and awaited) before this call, the draw races the fetch.
			if (fontsLoaded.length < 3) orderViolation = true;
		})
	};
	Object.defineProperty(fakeContext, 'textAlign', {
		configurable: true,
		set(value: string) {
			align = value;
		},
		get: () => align
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

	return { fontsLoaded, isOrderViolated: () => orderViolation, fakeContext, getAlign: () => align };
}

describe('renderVolunteerLabelPng', () => {
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
		name: 'สมชาย ใจ****ดี',
		badge: 'จิตอาสา · V-012'
	};

	it('preloads the label fonts before drawing anything', async () => {
		await renderVolunteerLabelPng(label);

		expect(harness.fontsLoaded).toHaveLength(3);
		expect(harness.isOrderViolated()).toBe(false);
	});

	it('draws exactly, in order, the name, the badge and the link', async () => {
		await renderVolunteerLabelPng(label);

		const texts = harness.fakeContext.fillText.mock.calls.map(([text]) => text);
		expect(texts).toEqual(['สมชาย ใจ****ดี', 'จิตอาสา · V-012', 'shelter.psu.ac.th']);
	});

	it("draws the link left-aligned at the layout's link position", async () => {
		let linkAlign = '';
		harness.fakeContext.fillText.mockImplementation((text: string) => {
			if (text === KIOSK_LABEL_LINK) linkAlign = harness.getAlign();
		});

		await renderVolunteerLabelPng(label);

		const { x, y } = volunteerLabelLayout(264).link;
		expect(linkAlign).toBe('left');
		expect(harness.fakeContext.fillText).toHaveBeenCalledWith(KIOSK_LABEL_LINK, x, y);
		expect(x).toBe(volunteerLabelLayout(264).text.x);
	});

	it('returns the PNG data as base64 without the data-URL prefix', async () => {
		expect(await renderVolunteerLabelPng(label)).toBe('ZmFrZS1wbmc=');
	});
});
