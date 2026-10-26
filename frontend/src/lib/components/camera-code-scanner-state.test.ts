import { describe, expect, it } from 'vitest';
import { acceptRead, scannerPhase } from './camera-code-scanner-state';

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
