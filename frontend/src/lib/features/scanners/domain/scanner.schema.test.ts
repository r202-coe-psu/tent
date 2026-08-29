import { describe, expect, it } from 'vitest';
import {
	createScannerDraftDoc,
	isScannerDraft,
	parseThaiSmartCardDate,
	scannerDeviceInputSchema,
	type SmartCardData
} from './scanner.schema';

describe('scanner.schema', () => {
	describe('parseThaiSmartCardDate', () => {
		it('parses valid Buddhist Era date to Christian Era and calculates age correctly', () => {
			const parsed = parseThaiSmartCardDate('25400512');
			expect(parsed.birth_year_ce).toBe(1997);
			expect(parsed.formatted_date).toBe('12/05/2540');
			expect(parsed.age).toBeGreaterThan(0);
		});

		it('handles empty or invalid string gracefully', () => {
			const parsed = parseThaiSmartCardDate('');
			expect(parsed.birth_year_ce).toBeNull();
			expect(parsed.age).toBeNull();
		});
	});

	describe('scannerDeviceInputSchema', () => {
		it('validates a correct device input', () => {
			const valid = {
				device_id: 'SCAN-SH001-A',
				name: 'จุดคัดกรอง 1',
				shelter_code: 'SH001',
				station_name: 'โต๊ะลงทะเบียน 1',
				status: 'active'
			};
			const result = scannerDeviceInputSchema.safeParse(valid);
			expect(result.success).toBe(true);
		});

		it('rejects invalid device_id with spaces or special characters', () => {
			const invalid = {
				device_id: 'SCAN SH001 @!',
				name: 'จุดคัดกรอง',
				shelter_code: 'SH001'
			};
			const result = scannerDeviceInputSchema.safeParse(invalid);
			expect(result.success).toBe(false);
		});
	});

	describe('createScannerDraftDoc', () => {
		it('creates a valid ScannerDraft doc with pending status and correct envelope', () => {
			const mockCard: SmartCardData = {
				citizen_id: '1234567890123',
				title_th: 'นาย',
				first_name_th: 'สมชาย',
				last_name_th: 'ใจดี',
				full_name_th: 'นาย สมชาย ใจดี',
				title_en: 'Mr.',
				first_name_en: 'Somchai',
				last_name_en: 'Jaidee',
				full_name_en: 'Mr. Somchai Jaidee',
				birth_date: '25350101',
				birth_year_ce: 1992,
				age: 34,
				gender: 'male',
				address_raw: '99/1#หมู่ 2#ซอยสุขใจ#ถนนสุขุมวิท#บางนา#บางนา#กรุงเทพมหานคร',
				address_no: '99/1',
				village_no: '2',
				lane: 'ซอยสุขใจ',
				road: 'ถนนสุขุมวิท',
				subdistrict: 'บางนา',
				district: 'บางนา',
				province: 'กรุงเทพมหานคร',
				postal_code: null,
				photo_base64: 'data:image/jpeg;base64,...',
				issuer: 'ที่ว่าการอำเภอ',
				issue_date: '25600101',
				expire_date: '25700101'
			};

			const draft = createScannerDraftDoc('SH001', 'DEV-01', 'โต๊ะ 1', mockCard, 24);
			expect(draft.type).toBe('scanner_draft');
			expect(draft.shelter_code).toBe('SH001');
			expect(draft.device_id).toBe('DEV-01');
			expect(draft.status).toBe('pending');
			expect(draft.card_data.citizen_id).toBe('1234567890123');
			expect(draft.card_data.first_name_th).toBe('สมชาย');
			expect(isScannerDraft(draft)).toBe(true);
		});
	});
});
