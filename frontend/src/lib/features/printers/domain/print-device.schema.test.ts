import { describe, expect, it } from 'vitest';
import {
	printerAdminSummarySchema,
	printerCreateInputSchema,
	printerPatchSchema
} from './print-device.schema';

const summary = {
	id: 'print_device:printer-sh001-kiosk-a',
	device_id: 'printer-sh001-kiosk-a',
	name: 'ตู้ kiosk A',
	shelter_code: 'SH001',
	station: null,
	status: 'active',
	secret_prefix: 'sk_print_01234567',
	last_seen_at: null,
	queue_state: 'unknown',
	agent_version: null,
	online: false
};

describe('printer schemas after the kiosk link was removed', () => {
	it('drops a stray kiosk_device_id from the admin summary', () => {
		const parsed = printerAdminSummarySchema.parse({ ...summary, kiosk_device_id: 'kiosk-a' });

		expect(parsed).not.toHaveProperty('kiosk_device_id');
	});

	it('drops a stray kiosk_device_id from create and patch input', () => {
		const created = printerCreateInputSchema.parse({
			device_id: 'printer-sh001-kiosk-a',
			name: 'ตู้ kiosk A',
			shelter_code: 'SH001',
			kiosk_device_id: 'kiosk-a'
		});
		const patched = printerPatchSchema.parse({ name: 'x', kiosk_device_id: 'kiosk-a' });

		expect(created).not.toHaveProperty('kiosk_device_id');
		expect(patched).not.toHaveProperty('kiosk_device_id');
	});
});
