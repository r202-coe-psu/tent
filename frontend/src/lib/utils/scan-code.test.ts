import { describe, expect, it } from 'vitest';
import { extractScanCode } from './scan-code';

describe('extractScanCode', () => {
	it('passes through a bare volunteer code unchanged', () => {
		expect(extractScanCode('V-002')).toBe('V-002');
	});

	it('passes through a bare tracking token unchanged', () => {
		expect(extractScanCode('TKT-VOL-KPZSA5TDGTB9S3YD')).toBe('TKT-VOL-KPZSA5TDGTB9S3YD');
	});

	it('extracts the token from a full digital-pass ticket URL', () => {
		expect(extractScanCode('http://localhost:5173/volunteer/ticket/TKT-VOL-KPZSA5TDGTB9S3YD')).toBe(
			'TKT-VOL-KPZSA5TDGTB9S3YD'
		);
	});

	it('extracts the token from a URL with query/hash params', () => {
		expect(
			extractScanCode('https://shelter.example/volunteer/ticket/TKT-VOL-ABC123?ref=qr#top')
		).toBe('TKT-VOL-ABC123');
	});

	it('strips a trailing slash rather than returning an empty segment', () => {
		expect(extractScanCode('https://shelter.example/volunteer/ticket/TKT-VOL-ABC123/')).toBe(
			'TKT-VOL-ABC123'
		);
	});

	it('trims surrounding whitespace', () => {
		expect(extractScanCode('  V-002  ')).toBe('V-002');
	});

	it('keeps a Person QR with @hash6 intact so the hash reaches the scan rule (CR-233)', () => {
		const qr = 'evacuee:01JC8ZQ4V6M2N5R7T9XBDEFGH0@683508';
		expect(extractScanCode(qr)).toBe(qr);
		expect(extractScanCode(`  ${qr}\n`)).toBe(qr);
	});
});
