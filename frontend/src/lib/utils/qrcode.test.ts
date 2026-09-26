// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { generateQrDataUrl, qrModuleCount } from './qrcode';

describe('QR code utilities', () => {
	it('returns the QR module count for an evacuee id', async () => {
		await expect(qrModuleCount('evacuee:01K5Z8Q2J9M7X3V4B6N8C0D2EF')).resolves.toBe(29);
	});

	it('does not generate a data URL during SSR', async () => {
		await expect(generateQrDataUrl('x')).resolves.toBe('');
	});

	it('does not generate a data URL for empty text', async () => {
		await expect(generateQrDataUrl('')).resolves.toBe('');
	});
});
