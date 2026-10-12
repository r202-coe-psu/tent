import { describe, expect, it } from 'vitest';
import { walkInAddressKey } from './walk-in-address';

const address = {
	address_no: '99/1',
	village_no: '4',
	lane: 'ซอย 5',
	road: 'สุขุมวิท',
	subdistrict: 'บางนา',
	district: 'บางนา',
	province: 'กรุงเทพมหานคร'
};

describe('walkInAddressKey', () => {
	it('gives the same key to the same address written with different spacing', () => {
		expect(walkInAddressKey({ ...address, lane: '  ซอย   5 ', road: 'สุขุมวิท ' })).toBe(
			walkInAddressKey(address)
		);
	});

	it('gives different keys when the lane or the road differs', () => {
		expect(walkInAddressKey({ ...address, lane: 'ซอย 6' })).not.toBe(walkInAddressKey(address));
		expect(walkInAddressKey({ ...address, road: 'เพชรเกษม' })).not.toBe(walkInAddressKey(address));
	});

	it('does not confuse which field a value sits in', () => {
		expect(walkInAddressKey({ ...address, village_no: '', lane: '4' })).not.toBe(
			walkInAddressKey({ ...address, village_no: '4', lane: '' })
		);
	});

	it('treats missing and empty optional fields alike', () => {
		expect(walkInAddressKey({ ...address, lane: undefined })).toBe(
			walkInAddressKey({ ...address, lane: '' })
		);
	});

	it.each(['address_no', 'subdistrict', 'district', 'province'] as const)(
		'has no key when %s is missing or blank',
		(field) => {
			expect(walkInAddressKey({ ...address, [field]: undefined })).toBeNull();
			expect(walkInAddressKey({ ...address, [field]: '  ' })).toBeNull();
		}
	);

	it('ignores the postal code', () => {
		expect(
			walkInAddressKey({ ...address, postal_code: '10260' } as Parameters<
				typeof walkInAddressKey
			>[0])
		).toBe(walkInAddressKey(address));
	});
});
