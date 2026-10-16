import { describe, expect, it } from 'vitest';
import { authenticateScannerDevice, hashScannerSecret } from './device-credentials';

const SECRET = 'sk_scan_test';

const doc = {
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
	secret_hash: hashScannerSecret(SECRET),
	secret_prefix: 'sk_scan_aaaaaaaa...',
	status: 'active',
	last_seen_at: null
};

const lookupOf = (value: Record<string, unknown>) => ({
	getDeviceByDeviceId: async () => value as never
});

describe('authenticateScannerDevice principal', () => {
	it('exposes banner_enabled, defaulting to true when the doc has none (FR-KBR-35)', async () => {
		const principal = await authenticateScannerDevice('SCAN-01', SECRET, lookupOf(doc));
		expect(principal.banner_enabled).toBe(true);
	});

	it('exposes screen_type, reading a doc without one as compact', async () => {
		const legacy = await authenticateScannerDevice('SCAN-01', SECRET, lookupOf(doc));
		expect(legacy.screen_type).toBe('compact');
		const portrait = await authenticateScannerDevice(
			'SCAN-01',
			SECRET,
			lookupOf({ ...doc, screen_type: 'portrait' })
		);
		expect(portrait.screen_type).toBe('portrait');
	});

	it('exposes an explicit banner_enabled=false', async () => {
		const principal = await authenticateScannerDevice(
			'SCAN-01',
			SECRET,
			lookupOf({ ...doc, banner_enabled: false })
		);
		expect(principal.banner_enabled).toBe(false);
	});
});
