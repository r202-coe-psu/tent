import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_PRINT_DONE_VISIBLE_MS, TestPrint, type TestPrintDeps } from './test-print.svelte';
import type { KioskPrintFlowResult } from './kiosk-print-flow';

afterEach(() => {
	vi.useRealTimers();
});

function setup(result: KioskPrintFlowResult | Error = { kind: 'printed', printed: 1 }) {
	const prepareQrImage = vi.fn<TestPrintDeps['prepareQrImage']>(async () => ({
		src: 'data:image/png;base64,QR',
		sizeMm: 20
	}));
	const printLabels = vi.fn<TestPrintDeps['printLabels']>(async () => {
		if (result instanceof Error) throw result;
		return result;
	});
	const fallbackPrint = vi.fn();
	const testPrint = new TestPrint({ prepareQrImage, printLabels, fallbackPrint });
	return { testPrint, prepareQrImage, printLabels, fallbackPrint };
}

describe('TestPrint', () => {
	it('starts idle and prints nothing until staff ask', () => {
		const { testPrint, printLabels } = setup();
		expect(testPrint.phase).toBe('idle');
		expect(printLabels).not.toHaveBeenCalled();
	});

	it('print() from idle prints exactly one label with the test payload and name', async () => {
		const { testPrint, prepareQrImage, printLabels } = setup();
		await testPrint.print();

		expect(prepareQrImage).toHaveBeenCalledExactlyOnceWith('KIOSK-TEST-PRINT');
		expect(printLabels).toHaveBeenCalledOnce();
		const [labels] = printLabels.mock.calls[0];
		expect(labels).toEqual([{ qrSrc: 'data:image/png;base64,QR', name: 'ทดสอบการพิมพ์' }]);
		expect(testPrint.phase).toBe('done');
	});

	it('is printing (idle clock paused) while the label is on its way', async () => {
		const { testPrint, printLabels } = setup();
		let release: (r: KioskPrintFlowResult) => void = () => {};
		printLabels.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
		const pending = testPrint.print();
		await vi.waitFor(() => expect(testPrint.phase).toBe('printing'));
		expect(testPrint.busy).toBe(true);
		release({ kind: 'printed', printed: 1 });
		await pending;
		expect(testPrint.busy).toBe(false);
	});

	it('hides the printed status after a moment', async () => {
		vi.useFakeTimers();
		const { testPrint } = setup();
		await testPrint.print();
		expect(testPrint.phase).toBe('done');
		vi.advanceTimersByTime(TEST_PRINT_DONE_VISIBLE_MS);
		expect(testPrint.phase).toBe('idle');
	});

	it('a printer error shows the message and does not retry on its own', async () => {
		const { testPrint, printLabels, fallbackPrint } = setup({
			kind: 'error',
			message: 'เครื่องพิมพ์ไม่พร้อม'
		});
		await testPrint.print();
		expect(testPrint.phase).toBe('error');
		expect(testPrint.error).toBe('เครื่องพิมพ์ไม่พร้อม');
		expect(printLabels).toHaveBeenCalledOnce();
		expect(fallbackPrint).not.toHaveBeenCalled();
	});

	it('a QR render failure is an error too', async () => {
		const { testPrint, prepareQrImage, printLabels } = setup();
		prepareQrImage.mockRejectedValueOnce(new Error('qr'));
		await testPrint.print();
		expect(testPrint.phase).toBe('error');
		expect(testPrint.error).not.toBe('');
		expect(printLabels).not.toHaveBeenCalled();
	});

	it('with no scanner client the browser print label sheet is used and the screen goes back to idle', async () => {
		const { testPrint } = setup({ kind: 'fallback' });
		await testPrint.print();
		expect(testPrint.phase).toBe('idle');
		expect(testPrint.labels).toHaveLength(1);
	});

	it('hands the browser fallback to the print flow', async () => {
		const { testPrint, printLabels, fallbackPrint } = setup();
		await testPrint.print();
		expect(printLabels.mock.calls[0][1]).toBe(fallbackPrint);
	});

	it('a second print() while printing does nothing', async () => {
		const { testPrint, printLabels } = setup();
		await Promise.all([testPrint.print(), testPrint.print()]);
		expect(printLabels).toHaveBeenCalledOnce();
	});

	it('print() again after an error clears the error and prints', async () => {
		const { testPrint, printLabels } = setup();
		printLabels.mockResolvedValueOnce({ kind: 'error', message: 'x' });
		await testPrint.print();
		expect(testPrint.phase).toBe('error');
		await testPrint.print();
		expect(testPrint.error).toBe('');
		expect(testPrint.phase).toBe('done');
		expect(printLabels).toHaveBeenCalledTimes(2);
	});

	it('print() again while the printed status shows prints another label', async () => {
		const { testPrint, printLabels } = setup();
		await testPrint.print();
		await testPrint.print();
		expect(printLabels).toHaveBeenCalledTimes(2);
	});

	it('dismiss clears an error', async () => {
		const { testPrint } = setup({ kind: 'error', message: 'x' });
		await testPrint.print();
		testPrint.dismiss();
		expect(testPrint.phase).toBe('idle');
		expect(testPrint.error).toBe('');
	});
});
