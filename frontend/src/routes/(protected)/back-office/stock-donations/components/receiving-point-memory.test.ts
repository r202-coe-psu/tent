// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	readReceivingPoint,
	receivingPointKey,
	writeReceivingPoint
} from './receiving-point-memory';

describe('receiving point memory (CR-206 FR-MP-18)', () => {
	beforeEach(() => localStorage.clear());
	afterEach(() => vi.restoreAllMocks());

	it('reads nothing before a point is picked', () => {
		expect(readReceivingPoint('SH001')).toBeNull();
	});

	it('remembers the point per shelter', () => {
		writeReceivingPoint('SH001', 'pt-gym');
		writeReceivingPoint('SH002', 'pt-med');
		expect(readReceivingPoint('SH001')).toBe('pt-gym');
		expect(readReceivingPoint('SH002')).toBe('pt-med');
	});

	it('forgets the point on null', () => {
		writeReceivingPoint('SH001', 'pt-gym');
		writeReceivingPoint('SH001', null);
		expect(localStorage.getItem(receivingPointKey('SH001'))).toBeNull();
	});

	it('survives storage that throws', () => {
		vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		expect(() => writeReceivingPoint('SH001', 'pt-gym')).not.toThrow();
		expect(readReceivingPoint('SH001')).toBeNull();
	});
});
