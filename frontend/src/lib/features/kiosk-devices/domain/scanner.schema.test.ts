import { describe, expect, it } from 'vitest';
import {
	chosenStaffPinSchema,
	isTrivialStaffPin,
	parseThaiSmartCardDate,
	scannerBootstrapDeviceSchema,
	scannerCreateResponseSchema,
	scannerDeviceInputSchema,
	scannerDeviceListResponseSchema,
	scannerDevicePatchSchema,
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

		it('defaults a new device to the compact kiosk and accepts portrait', () => {
			const base = { device_id: 'SCAN-01', name: 'ตู้ 1', shelter_code: 'SH001' };
			expect(scannerDeviceInputSchema.parse(base).screen_type).toBe('compact');
			expect(scannerDeviceInputSchema.parse({ ...base, screen_type: 'portrait' }).screen_type).toBe(
				'portrait'
			);
			expect(scannerDeviceInputSchema.safeParse({ ...base, screen_type: 'wide' }).success).toBe(
				false
			);
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

		it('reads a doc without banner_group_id as null and carries a stored group id', () => {
			expect(toScannerDeviceSummary(scannerDevicePersistedSchema.parse(v1Doc))).toMatchObject({
				banner_group_id: null
			});
			expect(toScannerDeviceSummary(scannerDevicePersistedSchema.parse(v2Doc))).toMatchObject({
				banner_group_id: null
			});
			for (const doc of [v1Doc, v2Doc]) {
				const parsed = scannerDevicePersistedSchema.parse({
					...doc,
					banner_group_id: 'kiosk_banner_group:lobby'
				});
				expect(toScannerDeviceSummary(parsed)).toMatchObject({
					banner_group_id: 'kiosk_banner_group:lobby'
				});
			}
		});

		it('reads a legacy banner_enabled doc but no longer reports it in the summary', () => {
			const parsed = scannerDevicePersistedSchema.parse({ ...v2Doc, banner_enabled: false });
			expect(toScannerDeviceSummary(parsed)).not.toHaveProperty('banner_enabled');
		});

		it('keeps banner_group_id in the summary but out of the bootstrap payload', () => {
			expect(Object.keys(scannerDeviceSummarySchema.shape)).toContain('banner_group_id');
			expect(Object.keys(scannerDeviceSummarySchema.shape)).not.toContain('banner_enabled');
			expect(Object.keys(scannerBootstrapDeviceSchema.shape)).not.toContain('banner_group_id');
		});

		it('reads a doc without screen_type as compact and carries a stored one', () => {
			expect(toScannerDeviceSummary(scannerDevicePersistedSchema.parse(v1Doc))).toMatchObject({
				screen_type: 'compact'
			});
			expect(toScannerDeviceSummary(scannerDevicePersistedSchema.parse(v2Doc))).toMatchObject({
				screen_type: 'compact'
			});
			const parsed = scannerDevicePersistedSchema.parse({ ...v2Doc, screen_type: 'portrait' });
			expect(toScannerDeviceSummary(parsed)).toMatchObject({ screen_type: 'portrait' });
			expect(
				scannerDevicePersistedSchema.safeParse({ ...v2Doc, screen_type: 'wide' }).success
			).toBe(false);
		});

		it('keeps screen_type in the summary but out of the bootstrap payload', () => {
			expect(Object.keys(scannerDeviceSummarySchema.shape)).toContain('screen_type');
			expect(Object.keys(scannerBootstrapDeviceSchema.shape)).not.toContain('screen_type');
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
		expect(kept.screen_type).toBe('compact');
		expect(JSON.stringify(kept)).not.toContain('483920');
		expect(scannerDeviceSummarySchema.safeParse(kept).success).toBe(true);
	});
});

describe('scannerDevicePatchSchema', () => {
	it('accepts a partial change and does not fill in fields that were not sent', () => {
		expect(scannerDevicePatchSchema.parse({ status: 'inactive' })).toEqual({ status: 'inactive' });
		expect(scannerDevicePatchSchema.parse({ name: ' เครื่อง 2 ' })).toEqual({ name: 'เครื่อง 2' });
	});

	it('rejects banner_enabled and banner_group_id (group is assigned from the group side)', () => {
		expect(scannerDevicePatchSchema.safeParse({ banner_enabled: false }).success).toBe(false);
		expect(
			scannerDevicePatchSchema.safeParse({ banner_group_id: 'kiosk_banner_group:lobby' }).success
		).toBe(false);
	});

	it('accepts screen_type alone and rejects an unknown screen', () => {
		expect(scannerDevicePatchSchema.parse({ screen_type: 'portrait' })).toEqual({
			screen_type: 'portrait'
		});
		expect(scannerDevicePatchSchema.safeParse({ screen_type: 'wide' }).success).toBe(false);
	});

	it('rejects an empty patch', () => {
		const result = scannerDevicePatchSchema.safeParse({});
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toBe('ไม่มีข้อมูลที่จะแก้ไข');
	});

	it.each([
		['shelter_code', { shelter_code: 'SH002' }],
		['device_id', { device_id: 'other-01' }],
		['staff_pin_set', { staff_pin_set: true }],
		['secret_hash', { secret_hash: 'a'.repeat(64) }]
	])('rejects the fixed or server-owned field %s', (_field, body) => {
		expect(scannerDevicePatchSchema.safeParse({ status: 'active', ...body }).success).toBe(false);
	});

	it('rejects a status outside active/inactive and a blank name or station', () => {
		expect(scannerDevicePatchSchema.safeParse({ status: 'paused' }).success).toBe(false);
		expect(scannerDevicePatchSchema.safeParse({ name: '  ' }).success).toBe(false);
		expect(scannerDevicePatchSchema.safeParse({ station_name: '' }).success).toBe(false);
	});
});

describe('scannerDeviceListResponseSchema', () => {
	it('parses a list of summaries and rejects extra material such as secret_hash', () => {
		const summary = toScannerDeviceSummary(scannerDevicePersistedSchema.parse(v2Doc));
		expect(scannerDeviceListResponseSchema.parse([summary])).toEqual([summary]);
		expect(scannerDeviceListResponseSchema.parse([])).toEqual([]);
		expect(
			scannerDeviceListResponseSchema.safeParse([{ ...summary, secret_hash: 'a'.repeat(64) }])
				.success
		).toBe(false);
	});
});
