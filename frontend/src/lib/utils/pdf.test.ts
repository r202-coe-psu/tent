// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';

type JsPDFOptions = { orientation: string; unit: string; format: [number, number] };

const setPropertiesMock = vi.fn();
const addImageMock = vi.fn();
const outputMock = vi.fn(() => 'blob:mock-url');
const jsPDFCtorMock = vi.fn(function MockJsPDF(options: JsPDFOptions) {
	void options;
	return { setProperties: setPropertiesMock, addImage: addImageMock, output: outputMock };
});

vi.mock('jspdf', () => ({ default: jsPDFCtorMock }));

let canvasWidth = 300;
let canvasHeight = 200;
const html2canvasMock = vi.fn(async () => ({
	width: canvasWidth,
	height: canvasHeight,
	toDataURL: () => 'data:image/png;base64,mock'
}));
vi.mock('html2canvas-pro', () => ({ default: html2canvasMock }));

const { previewElementAsPdf } = await import('./pdf');

describe('previewElementAsPdf', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		canvasWidth = 300;
		canvasHeight = 200;
		vi.spyOn(window, 'open').mockImplementation(() => null);
	});

	it('rasterizes the element with the default scale and a white background', async () => {
		const element = document.createElement('div');
		await previewElementAsPdf(element, 'ป้ายข้อมูล');

		expect(html2canvasMock).toHaveBeenCalledWith(element, {
			scale: 3,
			backgroundColor: '#ffffff',
			useCORS: true
		});
	});

	it('honors a custom scale option', async () => {
		const element = document.createElement('div');
		await previewElementAsPdf(element, 'title', { scale: 2 });

		expect(html2canvasMock).toHaveBeenCalledWith(element, expect.objectContaining({ scale: 2 }));
	});

	it('sizes a wide canvas as landscape and caps width at maxWidthMm', async () => {
		canvasWidth = 900; // wide relative to height -> landscape, and over the 70mm default cap
		canvasHeight = 300;
		const element = document.createElement('div');

		await previewElementAsPdf(element, 'title');

		expect(jsPDFCtorMock).toHaveBeenCalledWith(
			expect.objectContaining({ orientation: 'landscape', unit: 'mm' })
		);
		const { format } = jsPDFCtorMock.mock.calls[0][0];
		expect(format[0]).toBeCloseTo(70, 5); // shrunk to the default maxWidthMm cap
		expect(format[0]).toBeGreaterThan(format[1]); // still wider than tall
	});

	it('sizes a tall canvas as portrait', async () => {
		canvasWidth = 200;
		canvasHeight = 500;
		const element = document.createElement('div');

		await previewElementAsPdf(element, 'title');

		const call = jsPDFCtorMock.mock.calls[0][0];
		expect(call.orientation).toBe('portrait');
		expect(call.format[1]).toBeGreaterThan(call.format[0]);
	});

	it('does not shrink below maxWidthMm when the element is already small', async () => {
		canvasWidth = 100; // well under the default 70mm cap at scale 3
		canvasHeight = 60;
		const element = document.createElement('div');

		await previewElementAsPdf(element, 'title');

		const { format } = jsPDFCtorMock.mock.calls[0][0];
		const PX_TO_MM = 25.4 / 96;
		const expectedWidthMm = (100 / 3) * PX_TO_MM;
		expect(format[0]).toBeCloseTo(expectedWidthMm, 5);
	});

	it('respects a custom maxWidthMm cap', async () => {
		canvasWidth = 900;
		canvasHeight = 300;
		const element = document.createElement('div');

		await previewElementAsPdf(element, 'title', { maxWidthMm: 40 });

		const { format } = jsPDFCtorMock.mock.calls[0][0];
		expect(format[0]).toBeCloseTo(40, 5);
	});

	it('sets the document title, draws the rasterized image, and opens the result in a new tab', async () => {
		const element = document.createElement('div');
		const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

		await previewElementAsPdf(element, 'ป้ายข้อมูลผู้พักพิง');

		expect(setPropertiesMock).toHaveBeenCalledWith({ title: 'ป้ายข้อมูลผู้พักพิง' });
		expect(addImageMock).toHaveBeenCalledWith(
			'data:image/png;base64,mock',
			'PNG',
			0,
			0,
			expect.any(Number),
			expect.any(Number)
		);
		expect(openSpy).toHaveBeenCalledWith('blob:mock-url', '_blank');
	});
});
