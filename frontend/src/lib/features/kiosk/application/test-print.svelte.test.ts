import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StaffPinEntryDeps } from './staff-pin-entry.svelte';
import { StaffPinEntry } from './staff-pin-entry.svelte';
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
	it('starts idle and prints nothing until staff open the PIN panel', () => {
		const { testPrint, printLabels } = setup();
		expect(testPrint.phase).toBe('idle');
		expect(testPrint.pinOpen).toBe(false);
		expect(printLabels).not.toHaveBeenCalled();
	});

	it('asks for the PIN first: opening shows the panel and prints nothing', () => {
		const { testPrint, prepareQrImage, printLabels } = setup();
		testPrint.open();
		expect(testPrint.phase).toBe('pin');
		expect(testPrint.pinOpen).toBe(true);
		expect(prepareQrImage).not.toHaveBeenCalled();
		expect(printLabels).not.toHaveBeenCalled();
	});

	it('cancel closes the PIN panel without printing', () => {
		const { testPrint, printLabels } = setup();
		testPrint.open();
		testPrint.pinCancelled();
		expect(testPrint.phase).toBe('idle');
		expect(printLabels).not.toHaveBeenCalled();
	});

	it('a verified PIN prints exactly one label with the test payload and name', async () => {
		const { testPrint, prepareQrImage, printLabels } = setup();
		testPrint.open();
		await testPrint.pinVerified();

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
		testPrint.open();
		const pending = testPrint.pinVerified();
		await vi.waitFor(() => expect(testPrint.phase).toBe('printing'));
		expect(testPrint.busy).toBe(true);
		release({ kind: 'printed', printed: 1 });
		await pending;
		expect(testPrint.busy).toBe(false);
	});

	it('hides the printed status after a moment', async () => {
		vi.useFakeTimers();
		const { testPrint } = setup();
		testPrint.open();
		await testPrint.pinVerified();
		expect(testPrint.phase).toBe('done');
		vi.advanceTimersByTime(TEST_PRINT_DONE_VISIBLE_MS);
		expect(testPrint.phase).toBe('idle');
	});

	it('a printer error shows the message and does not retry on its own', async () => {
		const { testPrint, printLabels, fallbackPrint } = setup({
			kind: 'error',
			message: 'เครื่องพิมพ์ไม่พร้อม'
		});
		testPrint.open();
		await testPrint.pinVerified();
		expect(testPrint.phase).toBe('error');
		expect(testPrint.error).toBe('เครื่องพิมพ์ไม่พร้อม');
		expect(printLabels).toHaveBeenCalledOnce();
		expect(fallbackPrint).not.toHaveBeenCalled();
	});

	it('a QR render failure is an error too', async () => {
		const { testPrint, prepareQrImage, printLabels } = setup();
		prepareQrImage.mockRejectedValueOnce(new Error('qr'));
		testPrint.open();
		await testPrint.pinVerified();
		expect(testPrint.phase).toBe('error');
		expect(testPrint.error).not.toBe('');
		expect(printLabels).not.toHaveBeenCalled();
	});

	it('with no scanner client the browser print label sheet is used and the screen goes back to idle', async () => {
		const { testPrint } = setup({ kind: 'fallback' });
		testPrint.open();
		await testPrint.pinVerified();
		expect(testPrint.phase).toBe('idle');
		expect(testPrint.labels).toHaveLength(1);
	});

	it('hands the browser fallback to the print flow', async () => {
		const { testPrint, printLabels, fallbackPrint } = setup();
		testPrint.open();
		await testPrint.pinVerified();
		expect(printLabels.mock.calls[0][1]).toBe(fallbackPrint);
	});

	it('ignores a verified PIN when the panel is not open', async () => {
		const { testPrint, printLabels } = setup();
		await testPrint.pinVerified();
		expect(printLabels).not.toHaveBeenCalled();
		expect(testPrint.phase).toBe('idle');
	});

	it('ignores a second verified PIN while printing', async () => {
		const { testPrint, printLabels } = setup();
		testPrint.open();
		await Promise.all([testPrint.pinVerified(), testPrint.pinVerified()]);
		expect(printLabels).toHaveBeenCalledOnce();
	});

	it('dismiss clears an error', async () => {
		const { testPrint } = setup({ kind: 'error', message: 'x' });
		testPrint.open();
		await testPrint.pinVerified();
		testPrint.dismiss();
		expect(testPrint.phase).toBe('idle');
		expect(testPrint.error).toBe('');
	});

	it('wired to the staff PIN: a wrong PIN prints nothing, the right one prints once', async () => {
		const { testPrint, printLabels } = setup();
		const verify = vi
			.fn<StaffPinEntryDeps['verify']>()
			.mockResolvedValueOnce({ kind: 'wrong' })
			.mockResolvedValueOnce({ kind: 'verified' });
		const entry = new StaffPinEntry({
			verify,
			onverified: () => void testPrint.pinVerified(),
			oncancel: () => testPrint.pinCancelled()
		});
		testPrint.open();

		entry.pin = '111111';
		await entry.confirm();
		expect(entry.status.kind).toBe('wrong');
		expect(printLabels).not.toHaveBeenCalled();
		expect(testPrint.phase).toBe('pin');

		entry.pin = '222222';
		await entry.confirm();
		await vi.waitFor(() => expect(printLabels).toHaveBeenCalledOnce());
	});
});
