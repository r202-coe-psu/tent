import { describe, expect, it, vi } from 'vitest';
import { KioskPrintError } from '../data/kiosk-print.api';
import { runKioskPrintFlow } from './kiosk-print-flow';

describe('runKioskPrintFlow', () => {
	it('falls back to window.print() when no scanner client answers (404 → unavailable)', async () => {
		const fallbackPrint = vi.fn();
		const result = await runKioskPrintFlow({
			renderLabels: () => Promise.resolve(['label-1']),
			printLabels: () => Promise.resolve({ kind: 'unavailable' }),
			fallbackPrint
		});

		expect(result).toEqual({ kind: 'fallback' });
		expect(fallbackPrint).toHaveBeenCalledOnce();
	});

	it('reports how many labels printed before a partial failure, without falling back', async () => {
		const fallbackPrint = vi.fn();
		const result = await runKioskPrintFlow({
			renderLabels: () => Promise.resolve(['label-1', 'label-2', 'label-3']),
			printLabels: () =>
				Promise.reject(new KioskPrintError('ส่งงานพิมพ์ไม่สำเร็จ กรุณาลองอีกครั้ง', 2)),
			fallbackPrint
		});

		expect(result).toEqual({
			kind: 'error',
			message: 'ส่งงานพิมพ์ไม่สำเร็จ กรุณาลองอีกครั้ง (พิมพ์ออกแล้ว 2 ดวง)',
			labels: ['label-3']
		});
		expect(fallbackPrint).not.toHaveBeenCalled();
	});

	it('reports a plain failure message when nothing printed yet', async () => {
		const fallbackPrint = vi.fn();
		const result = await runKioskPrintFlow({
			renderLabels: () => Promise.resolve(['label-1']),
			printLabels: () => Promise.reject(new KioskPrintError('เชื่อมต่อเครื่องพิมพ์ไม่ได้', 0)),
			fallbackPrint
		});

		expect(result).toEqual({
			kind: 'error',
			message: 'เชื่อมต่อเครื่องพิมพ์ไม่ได้',
			labels: ['label-1']
		});
		expect(fallbackPrint).not.toHaveBeenCalled();
	});

	it('reports a render failure as an error and never falls back to window.print()', async () => {
		const fallbackPrint = vi.fn();
		const printLabels = vi.fn();
		const result = await runKioskPrintFlow({
			renderLabels: () => Promise.reject(new Error('QR image missing')),
			printLabels,
			fallbackPrint
		});

		expect(result).toEqual({
			kind: 'error',
			message: 'สร้าง label สำหรับพิมพ์ไม่สำเร็จ กรุณาลองอีกครั้ง',
			labels: []
		});
		expect(printLabels).not.toHaveBeenCalled();
		expect(fallbackPrint).not.toHaveBeenCalled();
	});

	it('returns the printed count on success', async () => {
		const result = await runKioskPrintFlow({
			renderLabels: () => Promise.resolve(['label-1', 'label-2']),
			printLabels: () => Promise.resolve({ kind: 'printed', printed: 2 }),
			fallbackPrint: vi.fn()
		});

		expect(result).toEqual({ kind: 'printed', printed: 2 });
	});

	it("returns the rendered labels for the screen on a 'none' printer without printing", async () => {
		const printLabels = vi.fn();
		const fallbackPrint = vi.fn();
		const result = await runKioskPrintFlow({
			renderLabels: () => Promise.resolve(['label-1', 'label-2']),
			printLabels,
			fallbackPrint,
			printer: 'none'
		});

		expect(result).toEqual({ kind: 'screen', labels: ['label-1', 'label-2'] });
		expect(printLabels).not.toHaveBeenCalled();
		expect(fallbackPrint).not.toHaveBeenCalled();
	});

	it("omits print wording from the render failure message on a 'none' printer", async () => {
		const thai = await runKioskPrintFlow({
			renderLabels: () => Promise.reject(new Error('canvas')),
			printLabels: vi.fn(),
			fallbackPrint: vi.fn(),
			printer: 'none',
			language: 'th'
		});
		const english = await runKioskPrintFlow({
			renderLabels: () => Promise.reject(new Error('canvas')),
			printLabels: vi.fn(),
			fallbackPrint: vi.fn(),
			printer: 'none',
			language: 'en'
		});

		expect(thai).toEqual({
			kind: 'error',
			message: 'สร้าง QR Code ไม่สำเร็จ กรุณาลองอีกครั้ง',
			labels: []
		});
		expect(english).toEqual({
			kind: 'error',
			message: 'Could not create the QR Code. Please try again.',
			labels: []
		});
	});
});
