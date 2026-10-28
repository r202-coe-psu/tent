// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	lastBulkReturnPoolKey,
	readLastBulkReturnPool,
	writeLastBulkReturnPool
} from './last-bulk-return-pool-storage';

describe('last bulk return pool storage', () => {
	beforeEach(() => localStorage.clear());
	afterEach(() => vi.restoreAllMocks());

	it('scopes the key by shelter', () => {
		expect(lastBulkReturnPoolKey('S1')).toBe('tent.distribution.lastBulkReturnPool:S1');
	});

	it('reads null when nothing is stored', () => {
		expect(readLastBulkReturnPool('S1')).toBeNull();
	});

	it('reads back what was written', () => {
		writeLastBulkReturnPool('S1', 'pool:a');
		expect(readLastBulkReturnPool('S1')).toBe('pool:a');
	});

	it('keeps shelters separate', () => {
		writeLastBulkReturnPool('S1', 'pool:a');
		writeLastBulkReturnPool('S2', 'pool:b');
		expect(readLastBulkReturnPool('S1')).toBe('pool:a');
		expect(readLastBulkReturnPool('S2')).toBe('pool:b');
	});

	it('does nothing without a shelter code', () => {
		writeLastBulkReturnPool('', 'pool:a');
		expect(readLastBulkReturnPool('')).toBeNull();
		expect(localStorage.length).toBe(0);
	});

	it('reads null without throwing when getItem throws', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		expect(readLastBulkReturnPool('S1')).toBeNull();
	});

	it('does not throw when setItem throws', () => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('quota');
		});
		expect(() => writeLastBulkReturnPool('S1', 'pool:a')).not.toThrow();
	});
});
