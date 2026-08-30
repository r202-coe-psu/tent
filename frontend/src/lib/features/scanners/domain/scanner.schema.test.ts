import { describe, expect, it } from 'vitest';
import { parseThaiSmartCardDate, scannerDeviceInputSchema } from './scanner.schema';

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
});
