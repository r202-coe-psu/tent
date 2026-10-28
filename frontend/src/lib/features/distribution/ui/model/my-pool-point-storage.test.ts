// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	MY_POOL_POINT_UNSPECIFIED,
	clearMyPoolPoint,
	myPoolPointKey,
	readMyPoolPoint,
	writeMyPoolPoint
} from './my-pool-point-storage';

describe('my pool point storage', () => {
	beforeEach(() => localStorage.clear());
	afterEach(() => vi.restoreAllMocks());

	it('scopes the key by shelter', () => {
		expect(myPoolPointKey('S1')).toBe('tent.distribution.myPoolPoint:S1');
	});

	it('reads null when nothing is stored', () => {
		expect(readMyPoolPoint('S1')).toBeNull();
	});

	it('reads back a point id and the unspecified sentinel', () => {
		writeMyPoolPoint('S1', 'sp-1');
		expect(readMyPoolPoint('S1')).toBe('sp-1');
		writeMyPoolPoint('S1', MY_POOL_POINT_UNSPECIFIED);
		expect(readMyPoolPoint('S1')).toBe('unspecified');
	});

	it('keeps shelters separate', () => {
		writeMyPoolPoint('S1', 'a');
		writeMyPoolPoint('S2', 'b');
		expect(readMyPoolPoint('S1')).toBe('a');
		expect(readMyPoolPoint('S2')).toBe('b');
	});

	it('clears the stored point', () => {
		writeMyPoolPoint('S1', 'a');
		clearMyPoolPoint('S1');
		expect(readMyPoolPoint('S1')).toBeNull();
	});

	it('does nothing without a shelter code', () => {
		writeMyPoolPoint('', 'a');
		writeMyPoolPoint(null, 'a');
		expect(readMyPoolPoint('')).toBeNull();
		expect(readMyPoolPoint(undefined)).toBeNull();
		expect(localStorage.length).toBe(0);
	});

	it('reads null without throwing when getItem throws', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		expect(readMyPoolPoint('S1')).toBeNull();
	});

	it('does not throw when setItem or removeItem throws', () => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('quota');
		});
		vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		expect(() => writeMyPoolPoint('S1', 'a')).not.toThrow();
		expect(() => clearMyPoolPoint('S1')).not.toThrow();
	});
});
