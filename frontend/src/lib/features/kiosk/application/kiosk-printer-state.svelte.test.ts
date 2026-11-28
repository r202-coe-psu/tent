import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KIOSK_HARDWARE } from '../domain/kiosk-hardware';

const mocks = vi.hoisted(() => ({ loadKioskHardware: vi.fn() }));
vi.mock('./kiosk-qr-input', () => ({ loadKioskHardware: mocks.loadKioskHardware }));

import { KioskPrinterState } from './kiosk-printer-state.svelte';

beforeEach(() => {
	vi.resetAllMocks();
});

describe('KioskPrinterState', () => {
	it('keeps the default printer until the scanner client answers', () => {
		mocks.loadKioskHardware.mockReturnValue(new Promise(() => {}));

		const state = new KioskPrinterState();

		expect(state.printer).toBe('cups');
		expect(state.hasNoPrinter).toBe(false);
	});

	it('holds the printer the scanner client reported once it is ready', async () => {
		mocks.loadKioskHardware.mockResolvedValue({ ...DEFAULT_KIOSK_HARDWARE, printer: 'none' });

		const state = new KioskPrinterState();
		await state.ready;

		expect(state.printer).toBe('none');
		expect(state.hasNoPrinter).toBe(true);
	});

	it('asks the scanner client for its hardware only once', async () => {
		mocks.loadKioskHardware.mockResolvedValue({ ...DEFAULT_KIOSK_HARDWARE, printer: 'escpos' });

		const state = new KioskPrinterState();
		await state.ready;

		expect(state.printer).toBe('escpos');
		expect(mocks.loadKioskHardware).toHaveBeenCalledTimes(1);
	});
});
