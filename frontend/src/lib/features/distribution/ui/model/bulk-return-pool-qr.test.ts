import { describe, expect, it } from 'vitest';
import { parsePoolScanCode, poolQrPayload } from './bulk-return-pool-qr';

const ID = 'bulk_return_pool:01J00000000000000000000001';

describe('poolQrPayload', () => {
	it('is the pool id as-is', () => {
		expect(poolQrPayload(ID)).toBe(ID);
	});
});

describe('parsePoolScanCode', () => {
	it('accepts a bare pool id and trims', () => {
		expect(parsePoolScanCode(`  ${ID} `)).toBe(ID);
	});

	it('normalises prefix and ULID case', () => {
		expect(parsePoolScanCode('BULK_RETURN_POOL:01j00000000000000000000001')).toBe(ID);
	});

	it('takes the last path segment and strips query/hash', () => {
		expect(parsePoolScanCode(`https://x.example/pool/${ID}?a=1#b`)).toBe(ID);
	});

	it('rejects other codes and malformed ULIDs', () => {
		expect(parsePoolScanCode('evacuee:01J00000000000000000000001')).toBeNull();
		expect(parsePoolScanCode('V-001')).toBeNull();
		expect(parsePoolScanCode('bulk_return_pool:123')).toBeNull();
		expect(parsePoolScanCode('bulk_return_pool:01J000000000000000000000012')).toBeNull();
		expect(parsePoolScanCode('')).toBeNull();
	});
});
