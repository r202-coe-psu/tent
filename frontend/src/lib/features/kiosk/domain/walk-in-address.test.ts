import { describe, expect, it } from 'vitest';
import type { CardSnapshot } from '$lib/features/people/domain/people';
import { walkInAddressKey } from './walk-in-address';

const address = {
	address_no: '99/1',
	village_no: '4',
	subdistrict: 'บางนา',
	district: 'บางนา',
	province: 'กรุงเทพมหานคร'
};

describe('walkInAddressKey', () => {
	it('gives the same key to the same address written with different spacing', () => {
		expect(walkInAddressKey({ ...address, subdistrict: '  บางนา ', village_no: ' 4  ' })).toBe(
			walkInAddressKey(address)
		);
	});

	it('ignores the lane and the road', () => {
		const withExtras = (extra: Partial<CardSnapshot>) => walkInAddressKey({ ...address, ...extra });
		expect(withExtras({ lane: 'ซอย 6' })).toBe(walkInAddressKey(address));
		expect(withExtras({ road: 'เพชรเกษม' })).toBe(walkInAddressKey(address));
		expect(withExtras({ lane: undefined, road: undefined })).toBe(walkInAddressKey(address));
	});

	it('does not confuse which field a value sits in', () => {
		expect(walkInAddressKey({ ...address, village_no: '', address_no: '4' })).not.toBe(
			walkInAddressKey({ ...address, village_no: '4', address_no: '' })
		);
	});

	it('treats missing and empty optional fields alike', () => {
		expect(walkInAddressKey({ ...address, village_no: undefined })).toBe(
			walkInAddressKey({ ...address, village_no: '' })
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

	describe('across card and ThaiD spellings', () => {
		const card = {
			address_no: '99/1',
			village_no: '3',
			lane: 'ซอยสุขใจ',
			road: 'ถนนเพชรเกษม',
			subdistrict: 'คลองแห',
			district: 'หาดใหญ่',
			province: 'สงขลา'
		};
		const thaid = {
			address_no: '99/1',
			village_no: 'หมู่ที่ 3',
			subdistrict: 'ตำบลคลองแห',
			district: 'อำเภอหาดใหญ่',
			province: 'จังหวัดสงขลา'
		};

		it('gives a card snapshot and a ThaiD snapshot without lane or road the same key', () => {
			expect(walkInAddressKey(thaid)).toBe(walkInAddressKey(card));
			expect(walkInAddressKey(card)).not.toBeNull();
		});

		it('ignores the type words and abbreviations in each part', () => {
			const abbreviated = {
				...thaid,
				village_no: 'ม.3',
				subdistrict: 'ต.คลองแห',
				district: 'อ.หาดใหญ่',
				province: 'จ.สงขลา'
			};
			expect(walkInAddressKey(abbreviated)).toBe(walkInAddressKey(card));
			expect(walkInAddressKey({ ...thaid, village_no: 'หมู่ 3' })).toBe(walkInAddressKey(card));
			expect(walkInAddressKey({ ...thaid, village_no: 'ม. 3' })).toBe(walkInAddressKey(card));
			expect(
				walkInAddressKey({ ...thaid, district: 'เขตหาดใหญ่', subdistrict: 'แขวงคลองแห' })
			).toBe(walkInAddressKey(card));
		});

		it('treats a dash like a missing optional part', () => {
			expect(walkInAddressKey({ ...card, village_no: '-' })).toBe(
				walkInAddressKey({ ...card, village_no: undefined })
			);
			expect(walkInAddressKey({ ...card, subdistrict: '-' })).toBeNull();
			expect(walkInAddressKey({ ...card, address_no: ' - ' })).toBeNull();
		});

		it('still tells a different village or house number apart', () => {
			expect(walkInAddressKey({ ...thaid, village_no: 'หมู่ที่ 4' })).not.toBe(
				walkInAddressKey(card)
			);
			expect(walkInAddressKey({ ...card, address_no: '99/2' })).not.toBe(walkInAddressKey(card));
		});
	});
});
