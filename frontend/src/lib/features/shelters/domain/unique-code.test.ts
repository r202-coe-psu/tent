import { describe, it, expect } from 'vitest';
import { uniqueByShelterCode } from './unique-code';

describe('uniqueByShelterCode', () => {
	it('keeps every shelter when codes are already unique', () => {
		const shelters = [{ code: 'SH001' }, { code: 'SH002' }];
		expect(uniqueByShelterCode(shelters)).toEqual(shelters);
	});

	it('keeps only the first shelter of a repeated code, in order', () => {
		const shelters = [
			{ code: 'SH001', name: 'first' },
			{ code: 'SH002', name: 'other' },
			{ code: 'SH001', name: 'duplicate' }
		];
		expect(uniqueByShelterCode(shelters)).toEqual([
			{ code: 'SH001', name: 'first' },
			{ code: 'SH002', name: 'other' }
		]);
	});

	it('returns an empty list for no shelters', () => {
		expect(uniqueByShelterCode([])).toEqual([]);
	});
});
