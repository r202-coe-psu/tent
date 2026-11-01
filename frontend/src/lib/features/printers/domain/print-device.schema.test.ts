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
	host_kind: 'kiosk',
	status: 'active',
	secret_prefix: 'sk_print_01234567',
	last_seen_at: null,
	queue_state: 'unknown',
	agent_version: null,
	online: false
};

describe('printerAdminSummarySchema kiosk link', () => {
	it('keeps the scanner device a kiosk printer is linked to', () => {
		const parsed = printerAdminSummarySchema.parse({ ...summary, kiosk_device_id: 'kiosk-a' });

		expect(parsed.kiosk_device_id).toBe('kiosk-a');
	});

	it('accepts an unlinked printer (null)', () => {
		expect(
			printerAdminSummarySchema.parse({ ...summary, kiosk_device_id: null }).kiosk_device_id
		).toBe(null);
	});
});

describe('printerCreateInputSchema kiosk link', () => {
	const input = {
		device_id: 'printer-sh001-kiosk-a',
		name: 'ตู้ kiosk A',
		shelter_code: 'SH001',
		host_kind: 'kiosk'
	};

	it('accepts a kiosk printer with its scanner device', () => {
		expect(
			printerCreateInputSchema.safeParse({ ...input, kiosk_device_id: 'kiosk-a' }).success
		).toBe(true);
	});

	it('rejects a kiosk_device_id on a standalone printer', () => {
		const result = printerCreateInputSchema.safeParse({
			...input,
			host_kind: 'standalone',
			kiosk_device_id: 'kiosk-a'
		});

		expect(result.success).toBe(false);
		expect(!result.success && result.error.issues[0]?.path).toEqual(['kiosk_device_id']);
	});
});

describe('printerPatchSchema kiosk link', () => {
	it('accepts linking a scanner device or clearing the link', () => {
		expect(printerPatchSchema.safeParse({ kiosk_device_id: 'kiosk-a' }).success).toBe(true);
		expect(printerPatchSchema.safeParse({ kiosk_device_id: null }).success).toBe(true);
	});
});
