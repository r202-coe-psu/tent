import { describe, expect, it } from 'vitest';
import { acceptRead, createReadGuard, scannerPhase } from './camera-code-scanner-state';

describe('camera scanner state', () => {
	it('maps busy flag to phase', () => {
		expect(scannerPhase(true)).toBe('busy');
		expect(scannerPhase(false)).toBe('idle');
	});
	it('accepts a trimmed code when idle', () => {
		expect(acceptRead('idle', '  abc ')).toBe('abc');
	});
	it('ignores reads while busy, however often repeated', () => {
		expect(acceptRead('busy', 'abc')).toBeNull();
		expect(acceptRead('busy', 'abc')).toBeNull();
	});
	it('ignores empty codes', () => {
		expect(acceptRead('idle', '   ')).toBeNull();
	});
});

describe('read guard', () => {
	it('keeps the current read live', () => {
		const guard = createReadGuard();
		expect(guard.begin()()).toBe(true);
	});
	it('drops a read once a later one begins', () => {
		const guard = createReadGuard();
		const first = guard.begin();
		const second = guard.begin();
		expect(first()).toBe(false);
		expect(second()).toBe(true);
	});
	it('drops a read in flight on cancel', () => {
		const guard = createReadGuard();
		const read = guard.begin();
		guard.cancel();
		expect(read()).toBe(false);
	});
	it('keeps a read that begins after a cancel', () => {
		const guard = createReadGuard();
		guard.cancel();
		expect(guard.begin()()).toBe(true);
	});
});
