import { describe, it, expect } from 'vitest';
import { normThaiAddressText, matchesResidenceAddress } from './registration-shell';

describe('normThaiAddressText', () => {
	it('normalizes thanthakhat variations correctly', () => {
		expect(normThaiAddressText('ถนนนิพัทธ์สงเคราะห์ 1 ซอย 6')).toBe(
			normThaiAddressText('ถนนนิพัทสงเคราะห์ 1 ซอย 6')
		);
		expect(normThaiAddressText('สงเคราะห์')).toBe(normThaiAddressText('สงเคราะ'));
	});

	it('normalizes road/lane/village abbreviations', () => {
		expect(normThaiAddressText('ถ.นิพัทธ์สงเคราะห์ 1')).toBe(
			normThaiAddressText('ถนนนิพัทธ์สงเคราะห์ 1')
		);
		expect(normThaiAddressText('ซ.6')).toBe(normThaiAddressText('ซอย 6'));
		expect(normThaiAddressText('ม.2')).toBe(normThaiAddressText('หมู่ 2'));
		expect(normThaiAddressText('หมู่ที่ 2')).toBe(normThaiAddressText('หมู่ 2'));
	});

	it('normalizes administrative prefixes', () => {
		expect(normThaiAddressText('จ.สงขลา')).toBe(normThaiAddressText('จังหวัดสงขลา'));
		expect(normThaiAddressText('อ.หาดใหญ่')).toBe(normThaiAddressText('อำเภอหาดใหญ่'));
		expect(normThaiAddressText('ต.คอหงส์')).toBe(normThaiAddressText('ตำบลคอหงส์'));
	});

	it('normalizes Thai numerals to Arabic', () => {
		expect(normThaiAddressText('๔๙/๑๒')).toBe('49/12');
		expect(normThaiAddressText('ซอย ๖')).toBe('ซอย 6');
	});

	it('normalizes whitespace around slashes and dashes', () => {
		expect(normThaiAddressText('49 / 12')).toBe('49/12');
		expect(normThaiAddressText('49-12')).toBe('49-12');
	});
});

describe('matchesResidenceAddress with Thai normalization', () => {
	const dbRecord = {
		address_no: '49/12',
		village_no: 'ถนนนิพัทธ์สงเคราะห์ 1 ซอย 6',
		subdistrict: 'คอหงส์',
		district: 'หาดใหญ่',
		province: 'สงขลา',
		postal_code: '90110'
	};

	it('matches when user input omits thanthakhat (smoke test case)', () => {
		const userInput = {
			address_no: '49/12',
			village_no: 'ถนนนิพัทสงเคราะห์ 1 ซอย 6',
			subdistrict: 'คอหงส์',
			district: 'หาดใหญ่',
			province: 'สงขลา',
			postal_code: '90110'
		};
		expect(matchesResidenceAddress(userInput, dbRecord)).toBe(true);
	});

	it('matches with abbreviations and thai numerals', () => {
		const userInput = {
			address_no: '๔๙/๑๒',
			village_no: 'ถ.นิพัทสงเคราะห์ 1 ซ.6',
			subdistrict: 'ต.คอหงส์',
			district: 'อ.หาดใหญ่',
			province: 'จ.สงขลา',
			postal_code: '90110'
		};
		expect(matchesResidenceAddress(userInput, dbRecord)).toBe(true);
	});

	it('rejects completely different house number or district', () => {
		const differentHouse = { ...dbRecord, address_no: '50/1' };
		expect(matchesResidenceAddress(differentHouse, dbRecord)).toBe(false);

		const differentDistrict = { ...dbRecord, district: 'เมืองสงขลา' };
		expect(matchesResidenceAddress(differentDistrict, dbRecord)).toBe(false);
	});
});
