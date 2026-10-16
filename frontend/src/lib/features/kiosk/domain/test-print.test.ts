import { describe, expect, it } from 'vitest';
import { TEST_PRINT_LABEL_NAME, TEST_PRINT_QR_PAYLOAD } from './test-print';

describe('test print label', () => {
	it('uses the agreed sample name and QR payload', () => {
		expect(TEST_PRINT_LABEL_NAME).toBe('ทดสอบการพิมพ์');
		expect(TEST_PRINT_QR_PAYLOAD).toBe('KIOSK-TEST-PRINT');
	});

	it('is never an evacuee QR, so a scanned test label is rejected at check-in', () => {
		expect(TEST_PRINT_QR_PAYLOAD).not.toMatch(/^evacuee:[0-9A-HJKMNP-TV-Z]{26}$/i);
		expect(TEST_PRINT_QR_PAYLOAD.toLowerCase().startsWith('evacuee:')).toBe(false);
	});
});
