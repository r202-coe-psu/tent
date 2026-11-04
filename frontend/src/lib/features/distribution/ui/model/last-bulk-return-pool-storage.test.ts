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

	it('scopes the key by shelter and user', () => {
		expect(lastBulkReturnPoolKey('S1', 'alice')).toBe(
			'tent.distribution.lastBulkReturnPool:S1:alice'
		);
	});

	it('reads null when nothing is stored', () => {
		expect(readLastBulkReturnPool('S1', 'alice')).toBeNull();
	});

	it('reads back what was written', () => {
		writeLastBulkReturnPool('S1', 'alice', 'pool:a');
		expect(readLastBulkReturnPool('S1', 'alice')).toBe('pool:a');
	});

	it('keeps shelters separate', () => {
		writeLastBulkReturnPool('S1', 'alice', 'pool:a');
		writeLastBulkReturnPool('S2', 'alice', 'pool:b');
		expect(readLastBulkReturnPool('S1', 'alice')).toBe('pool:a');
		expect(readLastBulkReturnPool('S2', 'alice')).toBe('pool:b');
	});

	it('keeps users separate: another staff member on the same device gets no default pool', () => {
		writeLastBulkReturnPool('S1', 'alice', 'pool:a');
		expect(readLastBulkReturnPool('S1', 'bob')).toBeNull();
		writeLastBulkReturnPool('S1', 'bob', 'pool:b');
		expect(readLastBulkReturnPool('S1', 'alice')).toBe('pool:a');
		expect(readLastBulkReturnPool('S1', 'bob')).toBe('pool:b');
	});

	it('ignores the old per-shelter key', () => {
		localStorage.setItem('tent.distribution.lastBulkReturnPool:S1', 'pool:old');
		expect(readLastBulkReturnPool('S1', 'alice')).toBeNull();
		writeLastBulkReturnPool('S1', 'alice', 'pool:a');
		expect(localStorage.getItem('tent.distribution.lastBulkReturnPool:S1')).toBe('pool:old');
	});

	it('does nothing without a shelter code', () => {
		writeLastBulkReturnPool('', 'alice', 'pool:a');
		expect(readLastBulkReturnPool('', 'alice')).toBeNull();
		expect(localStorage.length).toBe(0);
	});

	it('does nothing without a user', () => {
		writeLastBulkReturnPool('S1', '', 'pool:a');
		expect(readLastBulkReturnPool('S1', '')).toBeNull();
		expect(localStorage.length).toBe(0);
	});

	it('reads null without throwing when getItem throws', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		expect(readLastBulkReturnPool('S1', 'alice')).toBeNull();
	});

	it('does not throw when setItem throws', () => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('quota');
		});
		expect(() => writeLastBulkReturnPool('S1', 'alice', 'pool:a')).not.toThrow();
	});
});
