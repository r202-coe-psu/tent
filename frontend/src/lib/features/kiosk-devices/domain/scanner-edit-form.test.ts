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
	banner_group_id: null,
	screen_type: 'compact'
};

describe('scannerEditFormValues', () => {
	it('copies the editable fields of a device', () => {
		expect(scannerEditFormValues(device)).toStrictEqual({
			name: 'ตู้ประตู 1',
			station_name: 'จุดคัดกรองหลัก',
			status: 'active',
			screen_type: 'compact'
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
				station_name: ' ประตู 2 '
			})
		).toEqual({ station_name: 'ประตู 2' });
	});

	it('carries a screen type change and omits it when unchanged', () => {
		expect(
			scannerEditPatch(device, { ...scannerEditFormValues(device), screen_type: 'portrait' })
		).toEqual({ screen_type: 'portrait' });
		expect(
			scannerEditPatch(device, { ...scannerEditFormValues(device), status: 'inactive' })
		).not.toHaveProperty('screen_type');
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
