import { describe, expect, it } from 'vitest';
import { parseKioskQr } from './kiosk-qr';

describe('parseKioskQr', () => {
	it('reads an evacuee QR as an evacuee token with the ULID uppercased', () => {
		expect(parseKioskQr('Evacuee:01jd8x3k9qf2m7zp4r6t5v8w0y')).toEqual({
			kind: 'evacuee',
			token: 'evacuee:01JD8X3K9QF2M7ZP4R6T5V8W0Y'
		});
	});

	it('reads a bare ULID as an unassigned registration id, uppercased', () => {
		expect(parseKioskQr('01jd8x3k9qf2m7zp4r6t5v8w0y')).toEqual({
			kind: 'registration',
			registration_id: '01JD8X3K9QF2M7ZP4R6T5V8W0Y'
		});
	});

	it.each([
		['empty text', ''],
		['a URL', 'https://example.com/01JD8X3K9QF2M7ZP4R6T5V8W0Y'],
		['a household token', 'household:01JD8X3K9QF2M7ZP4R6T5V8W0Y'],
		['a 25-char ULID', '01JD8X3K9QF2M7ZP4R6T5V8W0'],
		['a 27-char ULID', '01JD8X3K9QF2M7ZP4R6T5V8W0YZ'],
		['a ULID with an invalid Crockford letter (U)', '01JD8X3K9QF2M7ZP4R6T5V8W0U'],
		['a ULID whose timestamp starts above 7', '81JD8X3K9QF2M7ZP4R6T5V8W0Y'],
		['an evacuee token with a short ULID', 'evacuee:01JD8X3K9QF2M7ZP4R6T5V8W0']
	])('rejects %s', (_label, text) => {
		expect(parseKioskQr(text)).toEqual({ kind: 'invalid' });
	});

	it('trims surrounding whitespace before reading either QR', () => {
		expect(parseKioskQr('  01JD8X3K9QF2M7ZP4R6T5V8W0Y\n')).toEqual({
			kind: 'registration',
			registration_id: '01JD8X3K9QF2M7ZP4R6T5V8W0Y'
		});
		expect(parseKioskQr('\tevacuee:01JD8X3K9QF2M7ZP4R6T5V8W0Y \r\n')).toEqual({
			kind: 'evacuee',
			token: 'evacuee:01JD8X3K9QF2M7ZP4R6T5V8W0Y'
		});
	});
});
