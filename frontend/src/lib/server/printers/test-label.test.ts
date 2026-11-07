import { describe, expect, it } from 'vitest';
import { isPrintableLabel } from '$lib/features/printers';
import { TEST_LABEL_PNG_BASE64 } from './test-label';

describe('TEST_LABEL_PNG_BASE64', () => {
	it('is a label the staff API would accept (639x479, allowed PNG format, within 64 KB)', () => {
		expect(isPrintableLabel(TEST_LABEL_PNG_BASE64)).toBe(true);
	});

	it('is a 1-bit gray PNG', () => {
		const header = Buffer.from(TEST_LABEL_PNG_BASE64, 'base64');

		expect(header.readUInt32BE(16)).toBe(639);
		expect(header.readUInt32BE(20)).toBe(479);
		expect([header[24], header[25]]).toEqual([1, 0]);
	});
});
