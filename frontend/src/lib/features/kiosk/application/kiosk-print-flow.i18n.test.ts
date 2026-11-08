import { describe, expect, it, vi } from 'vitest';
import { compareLanguages } from '$lib/testing/i18n-parity';
import { KioskPrintError } from '../data/kiosk-print.api';
import { KIOSK_PRINT_FLOW_I18N } from './kiosk-print-flow.i18n';
import { runKioskPrintFlow } from './kiosk-print-flow';

const base = {
	renderLabels: () => Promise.resolve(['label-1']),
	fallbackPrint: vi.fn()
};

describe('runKioskPrintFlow language', () => {
	it('words a render failure in English', async () => {
		const result = await runKioskPrintFlow({
			...base,
			renderLabels: () => Promise.reject(new Error('QR image missing')),
			printLabels: vi.fn(),
			language: 'en'
		});

		expect(result).toEqual({
			kind: 'error',
			message: 'Could not create the label to print. Please try again.'
		});
	});

	it('words a printer connection failure in English, with how many printed', async () => {
		const result = await runKioskPrintFlow({
			...base,
			printLabels: () =>
				Promise.reject(
					new KioskPrintError('เชื่อมต่อเครื่องพิมพ์ไม่ได้ กรุณาลองอีกครั้ง', 2, 'connection')
				),
			language: 'en'
		});

		expect(result).toEqual({
			kind: 'error',
			message: 'Could not reach the printer. Please try again. (2 printed)'
		});
	});

	it('keeps the printer own message as it came when it gave one', async () => {
		const result = await runKioskPrintFlow({
			...base,
			printLabels: () => Promise.reject(new KioskPrintError('กระดาษหมด', 0)),
			language: 'en'
		});

		expect(result).toEqual({ kind: 'error', message: 'กระดาษหมด' });
	});

	it('keeps the Thai wording when the language is Thai', async () => {
		const result = await runKioskPrintFlow({
			...base,
			printLabels: () =>
				Promise.reject(
					new KioskPrintError('เชื่อมต่อเครื่องพิมพ์ไม่ได้ กรุณาลองอีกครั้ง', 1, 'connection')
				),
			language: 'th'
		});

		expect(result).toEqual({
			kind: 'error',
			message: 'เชื่อมต่อเครื่องพิมพ์ไม่ได้ กรุณาลองอีกครั้ง (พิมพ์ออกแล้ว 1 ดวง)'
		});
	});
});

describe('KIOSK_PRINT_FLOW_I18N', () => {
	it('has the same keys in both languages and no Thai in English', () => {
		const { thKeys, enKeys, thaiInEn } = compareLanguages(KIOSK_PRINT_FLOW_I18N);

		expect(enKeys).toEqual(thKeys);
		expect(thaiInEn).toEqual([]);
	});
});
