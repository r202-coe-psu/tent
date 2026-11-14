import { describe, expect, it } from 'vitest';
import {
	SCANNER_CLIENT_PRINT_I18N,
	scannerClientPrintErrorMessage
} from './scanner-client-print.i18n';

describe('scanner client print button text', () => {
	it('names the printer of this PC, and the family size when printing a family', () => {
		expect(SCANNER_CLIENT_PRINT_I18N.th.printHere(1, 'XP-365B')).toBe(
			'พิมพ์ที่เครื่องนี้ (XP-365B)'
		);
		expect(SCANNER_CLIENT_PRINT_I18N.th.printHere(4, 'XP-365B')).toBe(
			'พิมพ์ทั้งครอบครัวที่เครื่องนี้ (4 ใบ)'
		);
		expect(SCANNER_CLIENT_PRINT_I18N.en.printHere(1, 'XP-365B')).toBe('Print here (XP-365B)');
		expect(SCANNER_CLIENT_PRINT_I18N.en.printHere(4, 'XP-365B')).toBe(
			'Print whole family here (4 labels)'
		);
	});
});

describe('scannerClientPrintErrorMessage', () => {
	it('says what went wrong at which printer', () => {
		expect(scannerClientPrintErrorMessage('PRINTER_NOT_FOUND', 'XP-365B', 0, 'th')).toBe(
			'ไม่พบเครื่องพิมพ์ XP-365B ในเครื่องนี้'
		);
		expect(scannerClientPrintErrorMessage('connection', 'XP-365B', 0, 'en')).toBe(
			'Could not reach the scanner client on this PC'
		);
	});

	it('adds how many labels already printed, so staff do not print them twice', () => {
		expect(scannerClientPrintErrorMessage('PRINT_FAILED', 'XP-365B', 3, 'th')).toBe(
			'ส่งงานพิมพ์ไปที่ XP-365B ไม่สำเร็จ ตรวจสอบสาย กระดาษ และไฟของเครื่องพิมพ์ (พิมพ์ไปแล้ว 3 ใบ)'
		);
	});

	it('has every message in both languages', () => {
		expect(Object.keys(SCANNER_CLIENT_PRINT_I18N.en.failed).sort()).toEqual(
			Object.keys(SCANNER_CLIENT_PRINT_I18N.th.failed).sort()
		);
	});
});
