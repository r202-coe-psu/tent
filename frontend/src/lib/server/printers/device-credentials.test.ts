import { describe, expect, it } from 'vitest';
import {
	authenticatePrintDevice,
	generatePrintSecret,
	hashPrintSecret,
	PrintAuthError,
	type PrintDeviceDoc
} from './device-credentials';

const SECRET = 'sk_print_test_secret';

const doc: PrintDeviceDoc = {
	_id: 'print_device:printer-sh001-reg1',
	_rev: '1-a',
	type: 'print_device',
	schema_v: 1,
	device_id: 'printer-sh001-reg1',
	name: 'จุดลงทะเบียน 1',
	shelter_code: 'SH001',
	station: null,
	host_kind: 'standalone',
	secret_hash: hashPrintSecret(SECRET),
	secret_prefix: 'sk_print_test_sec',
	status: 'active',
	last_seen_at: null,
	queue_state: 'unknown',
	agent_version: null,
	created_at: '2026-10-22T00:00:00.000Z',
	updated_at: '2026-10-22T00:00:00.000Z',
	created_by: 'sa-user'
};

const lookupOf = (value: PrintDeviceDoc | null) => ({
	getDeviceByDeviceId: async () => value
});

describe('authenticatePrintDevice', () => {
	it('returns the principal of an active device presenting the right secret', async () => {
		const principal = await authenticatePrintDevice('printer-sh001-reg1', SECRET, lookupOf(doc));
		expect(principal).toEqual({
			registry_id: 'print_device:printer-sh001-reg1',
			device_id: 'printer-sh001-reg1',
			name: 'จุดลงทะเบียน 1',
			shelter_code: 'SH001'
		});
	});

	it.each([
		['wrong secret', 'printer-sh001-reg1', 'sk_print_wrong', doc],
		['unknown device', 'printer-sh001-reg1', SECRET, null],
		['empty device id', '', SECRET, doc],
		['empty secret', 'printer-sh001-reg1', '', doc],
		['device id mismatch', 'printer-sh001-reg1', SECRET, { ...doc, device_id: 'printer-other' }],
		['inactive device', 'printer-sh001-reg1', SECRET, { ...doc, status: 'inactive' as const }]
	])('rejects %s with PrintAuthError', async (_label, deviceId, secret, found) => {
		await expect(authenticatePrintDevice(deviceId, secret, lookupOf(found))).rejects.toBeInstanceOf(
			PrintAuthError
		);
	});
});

describe('print secrets', () => {
	it('generates distinct secrets with the sk_print_ prefix', () => {
		const first = generatePrintSecret();
		const second = generatePrintSecret();
		expect(first.startsWith('sk_print_')).toBe(true);
		expect(first).not.toBe(second);
	});

	it('hashes a secret to its SHA-256 hex digest', () => {
		// echo -n sk_print_literal_secret | sha256sum
		expect(hashPrintSecret('sk_print_literal_secret')).toBe(
			'a6339bb9b145941093a066c425ad36c51ac267aeb57049f0de77137ec024378f'
		);
	});
});
