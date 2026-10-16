import { describe, expect, it } from 'vitest';
import type { ScannerDeviceSummary } from './scanner.schema';
import {
	scannerEditFormSchema,
	scannerEditFormValues,
	scannerEditPatch
} from './scanner-edit-form';

const device: ScannerDeviceSummary = {
	id: 'scanner:a',
	device_id: 'SCAN-01',
	name: 'ตู้ประตู 1',
	shelter_code: 'SH001',
	station_name: 'จุดคัดกรองหลัก',
	status: 'active',
	last_seen_at: null,
	staff_pin_set: true,
	staff_pin_is_default: false,
	banner_enabled: true
};

describe('scannerEditFormValues', () => {
	it('copies the editable fields of a device', () => {
		expect(scannerEditFormValues(device)).toEqual({
			name: 'ตู้ประตู 1',
			station_name: 'จุดคัดกรองหลัก',
			status: 'active',
			banner_enabled: true
		});
	});
});

describe('scannerEditPatch', () => {
	it('is null when nothing changed (whitespace around text does not count)', () => {
		expect(
			scannerEditPatch(device, { ...scannerEditFormValues(device), name: '  ตู้ประตู 1 ' })
		).toBeNull();
	});

	it('holds only the changed fields, trimmed', () => {
		expect(
			scannerEditPatch(device, {
				...scannerEditFormValues(device),
				station_name: ' ประตู 2 ',
				banner_enabled: false
			})
		).toEqual({ station_name: 'ประตู 2', banner_enabled: false });
	});

	it('carries a status change', () => {
		expect(
			scannerEditPatch(device, { ...scannerEditFormValues(device), status: 'inactive' })
		).toEqual({ status: 'inactive' });
	});
});

describe('scannerEditFormSchema', () => {
	it('requires a name and a service point', () => {
		const result = scannerEditFormSchema.safeParse({
			...scannerEditFormValues(device),
			name: ' ',
			station_name: ''
		});
		expect(result.success).toBe(false);
		const paths = result.error?.issues.map((issue) => issue.path[0]);
		expect(paths).toEqual(expect.arrayContaining(['name', 'station_name']));
	});
});
