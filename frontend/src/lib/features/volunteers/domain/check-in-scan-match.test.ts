import { describe, expect, it } from 'vitest';
import { matchCheckInScan } from './check-in-scan-match';

const somchai = {
	_id: 'volunteer:001',
	volunteer_code: 'V-001',
	first_name: 'สมชาย',
	last_name: 'ใจดี'
};

describe('matchCheckInScan', () => {
	it('matches when the scanned volunteer is the expected one', () => {
		expect(matchCheckInScan('volunteer:001', somchai)).toEqual({ kind: 'match' });
	});

	it('names the other volunteer when the QR belongs to someone else', () => {
		expect(matchCheckInScan('volunteer:002', somchai)).toEqual({
			kind: 'mismatch',
			scannedName: 'สมชาย ใจดี',
			scannedCode: 'V-001'
		});
	});

	it('trims the name when the last name is blank', () => {
		const result = matchCheckInScan('volunteer:002', { ...somchai, last_name: '' });
		expect(result).toMatchObject({ kind: 'mismatch', scannedName: 'สมชาย' });
	});

	it('is unknown when the scan resolved to no volunteer', () => {
		expect(matchCheckInScan('volunteer:001', null)).toEqual({ kind: 'unknown' });
	});
});
