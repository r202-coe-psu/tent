import { describe, expect, it } from 'vitest';
import {
	chosenStaffPinSchema,
	isTrivialStaffPin,
	parseThaiSmartCardDate,
	scannerBootstrapDeviceSchema,
	scannerCreateResponseSchema,
	scannerDeviceInputSchema,
	scannerDevicePersistedSchema,
	setStaffPinFormSchema,
	smartCardDataSchema,
	staffPinSchema,
	staffPinUpdateRequestSchema,
	scannerDeviceSummarySchema,
	toScannerDeviceSummary,
	withoutScannerPlaintext
} from './scanner.schema';

const v1Doc = {
	_id: 'scanner_device:SCAN-01',
	_rev: '1-a',
	type: 'scanner_device',
	schema_v: 1,
	created_at: '2026-08-30T00:00:00Z',
	updated_at: '2026-08-30T00:00:00Z',
	created_by: 'admin',
	device_id: 'SCAN-01',
	name: 'จุดคัดกรอง 1',
	shelter_code: 'SH001',
	station_name: 'โต๊ะ 1',
	secret_hash: 'a'.repeat(64),
	secret_prefix: 'sk_scan_aaaaaaaa...',
	status: 'active',
	last_seen_at: null
};

const v2Doc = {
	...v1Doc,
	schema_v: 2,
	staff_pin_set: true,
	staff_pin_is_default: true,
	staff_pin_updated_at: '2026-10-08T00:00:00Z',
	staff_pin_updated_by: 'admin'
};

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

	describe('smartCardDataSchema', () => {
		it('accepts only a 13-digit citizen ID', () => {
			expect(smartCardDataSchema.safeParse({ citizen_id: '1234567890123' }).success).toBe(true);
			expect(smartCardDataSchema.safeParse({ citizen_id: '12345678901A3' }).success).toBe(false);
			expect(smartCardDataSchema.safeParse({ citizen_id: '123456789012' }).success).toBe(false);
		});

		it('rejects oversized card photo payloads', () => {
			expect(
				smartCardDataSchema.safeParse({
					citizen_id: '1234567890123',
					photo_base64: 'x'.repeat(2_000_001)
				}).success
			).toBe(false);
		});
	});

	describe('scannerDevicePersistedSchema (v1 + v2)', () => {
		it('still parses v1 docs and summarises them as having no PIN', () => {
			const parsed = scannerDevicePersistedSchema.parse(v1Doc);
			expect(toScannerDeviceSummary(parsed)).toMatchObject({
				staff_pin_set: false,
				staff_pin_is_default: false
			});
		});

		it('parses v2 docs and exposes only PIN flags in the summary', () => {
			const summary = toScannerDeviceSummary(scannerDevicePersistedSchema.parse(v2Doc));
			expect(summary).toMatchObject({ staff_pin_set: true, staff_pin_is_default: true });
			expect(summary).not.toHaveProperty('staff_pin_updated_by');
		});

		it('rejects PIN fields on a v1 doc and a v2 doc missing them', () => {
			expect(
				scannerDevicePersistedSchema.safeParse({ ...v1Doc, staff_pin_set: false }).success
			).toBe(false);
			expect(scannerDevicePersistedSchema.safeParse({ ...v1Doc, schema_v: 2 }).success).toBe(false);
		});

		it('rejects any PIN material on the registry doc', () => {
			expect(scannerDevicePersistedSchema.safeParse({ ...v2Doc, pin: '482913' }).success).toBe(
				false
			);
			expect(
				scannerDevicePersistedSchema.safeParse({ ...v2Doc, staff_pin_enc: 'v1$x' }).success
			).toBe(false);
		});

		it('never reports a default PIN when none is set', () => {
			const parsed = scannerDevicePersistedSchema.parse({ ...v2Doc, staff_pin_set: false });
			expect(toScannerDeviceSummary(parsed)).toMatchObject({
				staff_pin_set: false,
				staff_pin_is_default: false
			});
		});

		it('keeps PIN state out of the bootstrap device payload', () => {
			expect(Object.keys(scannerBootstrapDeviceSchema.shape)).not.toContain('staff_pin_set');
		});

		it('requires a 6-digit plaintext_staff_pin on the create response', () => {
			const device = toScannerDeviceSummary(scannerDevicePersistedSchema.parse(v2Doc));
			const base = { device, plaintext_secret: 'sk_scan_x' };
			expect(scannerCreateResponseSchema.safeParse(base).success).toBe(false);
			expect(
				scannerCreateResponseSchema.safeParse({ ...base, plaintext_staff_pin: '482913' }).success
			).toBe(true);
			expect(
				scannerCreateResponseSchema.safeParse({ ...base, plaintext_staff_pin: null }).success
			).toBe(false);
		});
	});

	describe('staff PIN schemas', () => {
		it('accepts exactly six digits', () => {
			expect(staffPinSchema.safeParse('482913').success).toBe(true);
			for (const bad of ['48291', '4829134', '48291a', ' 482913', '']) {
				expect(staffPinSchema.safeParse(bad).success).toBe(false);
			}
		});

		it.each([
			'000000',
			'777777',
			'123456',
			'654321',
			'012345',
			'987654',
			'112233',
			'998877',
			'121212',
			'123123',
			'907907',
			'111222',
			'101010',
			'100000'
		])('treats %s as trivial', (pin) => {
			expect(isTrivialStaffPin(pin)).toBe(true);
			expect(chosenStaffPinSchema.safeParse(pin).success).toBe(false);
		});

		it.each(['482913', '135790', '123457', '112234', '123321'])('accepts %s', (pin) => {
			expect(isTrivialStaffPin(pin)).toBe(false);
			expect(chosenStaffPinSchema.safeParse(pin).success).toBe(true);
		});

		it('requires the confirmation to match', () => {
			const mismatch = setStaffPinFormSchema.safeParse({ pin: '482913', confirm: '482914' });
			expect(mismatch.success).toBe(false);
			expect(mismatch.error?.issues[0]?.path).toEqual(['confirm']);
			expect(setStaffPinFormSchema.safeParse({ pin: '482913', confirm: '482913' }).success).toBe(
				true
			);
		});

		it('accepts either a chosen PIN or regenerate, nothing else', () => {
			expect(staffPinUpdateRequestSchema.safeParse({ pin: '482913' }).success).toBe(true);
			expect(staffPinUpdateRequestSchema.safeParse({ regenerate: true }).success).toBe(true);
			expect(staffPinUpdateRequestSchema.safeParse({ pin: '123456' }).success).toBe(false);
			expect(staffPinUpdateRequestSchema.safeParse({ regenerate: false }).success).toBe(false);
			expect(
				staffPinUpdateRequestSchema.safeParse({ pin: '482913', regenerate: true }).success
			).toBe(false);
			expect(staffPinUpdateRequestSchema.safeParse({}).success).toBe(false);
		});
	});
});

describe('withoutScannerPlaintext', () => {
	it('drops the one-time secret and default PIN and keeps a valid summary', () => {
		const summary = toScannerDeviceSummary(scannerDevicePersistedSchema.parse(v2Doc));
		const created = { ...summary, plaintext_secret: 'sk_scan_x', plaintext_staff_pin: '483920' };

		const kept = withoutScannerPlaintext(created);

		expect(kept).toEqual(summary);
		expect(JSON.stringify(kept)).not.toContain('483920');
		expect(scannerDeviceSummarySchema.safeParse(kept).success).toBe(true);
	});
});
