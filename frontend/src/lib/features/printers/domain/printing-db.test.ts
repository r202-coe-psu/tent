import { describe, expect, it } from 'vitest';
import { PRINTING_DEVICES_DB, printingDbName, shelterCodeFromPrintingDb } from './printing-db';

describe('PRINTING_DEVICES_DB', () => {
	it('is the shared device registry database', () => {
		expect(PRINTING_DEVICES_DB).toBe('printing_devices');
	});
});

describe('printingDbName', () => {
	it.each([
		['SH001', 'printing_sh001'],
		['sh001', 'printing_sh001'],
		['Sh002', 'printing_sh002']
	])('%s -> %s', (code, expected) => {
		expect(printingDbName(code)).toBe(expected);
	});

	it.each(['', '../_users', 'sh-1', 'SH 001', 'SH001/..', 'ศูนย์1', 'devices'])(
		'throws for invalid shelter code %j',
		(code) => {
			expect(() => printingDbName(code)).toThrow();
		}
	);
});

describe('shelterCodeFromPrintingDb', () => {
	it.each([
		['printing_sh001', 'SH001'],
		['printing_SH002', 'SH002']
	])('%s -> %s', (db, expected) => {
		expect(shelterCodeFromPrintingDb(db)).toBe(expected);
	});

	it.each([
		'printing_devices',
		'printing_devices_x',
		'shelter_sh001',
		'printing_',
		'printing_sh-1',
		'printing_../x',
		''
	])('returns null for %j', (db) => {
		expect(shelterCodeFromPrintingDb(db)).toBeNull();
	});

	it('round-trips with printingDbName', () => {
		expect(shelterCodeFromPrintingDb(printingDbName('sh007'))).toBe('SH007');
	});
});
