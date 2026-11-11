import { describe, expect, it } from 'vitest';
import { generateDeviceSecret, hashDeviceSecret, verifyDeviceSecret } from './secret';

describe('generateDeviceSecret', () => {
	it('returns the prefix followed by 64 lowercase hex characters', () => {
		expect(generateDeviceSecret('sk_scan_')).toMatch(/^sk_scan_[0-9a-f]{64}$/);
		expect(generateDeviceSecret('sk_print_')).toMatch(/^sk_print_[0-9a-f]{64}$/);
	});

	it('generates distinct secrets on every call', () => {
		expect(generateDeviceSecret('sk_print_')).not.toBe(generateDeviceSecret('sk_print_'));
	});
});

describe('hashDeviceSecret', () => {
	it('hashes a secret to its SHA-256 hex digest', () => {
		// echo -n sk_print_literal_secret | sha256sum
		expect(hashDeviceSecret('sk_print_literal_secret')).toBe(
			'a6339bb9b145941093a066c425ad36c51ac267aeb57049f0de77137ec024378f'
		);
	});
});

describe('verifyDeviceSecret', () => {
	const stored = 'a6339bb9b145941093a066c425ad36c51ac267aeb57049f0de77137ec024378f';

	it('accepts the secret whose hash is stored', () => {
		expect(verifyDeviceSecret('sk_print_literal_secret', stored)).toBe(true);
	});

	it('rejects a different secret', () => {
		expect(verifyDeviceSecret('sk_print_wrong', stored)).toBe(false);
	});

	it('rejects a stored hash of the wrong length', () => {
		expect(verifyDeviceSecret('sk_print_literal_secret', stored.slice(0, 32))).toBe(false);
		expect(verifyDeviceSecret('sk_print_literal_secret', `${stored}00`)).toBe(false);
	});

	it.each([
		['empty', ''],
		['non-hex', 'not-a-hash'],
		['odd-length hex', 'abc']
	])('rejects a malformed stored hash (%s) without throwing', (_label, malformed) => {
		expect(verifyDeviceSecret('sk_print_literal_secret', malformed)).toBe(false);
	});
});
