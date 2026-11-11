// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { generateQrDataUrl, qrModuleCount } from './qrcode';

describe('QR code utilities', () => {
	it('returns the QR module count for an evacuee id', async () => {
		await expect(qrModuleCount('evacuee:01K5Z8Q2J9M7X3V4B6N8C0D2EF')).resolves.toBe(29);
	});

	// CR-233 FR-EQR-7 / AC-EQR-13: `@hash6` must not grow the code (41 chars, version 3).
	it('keeps a hashed person QR `evacuee:{ULID}@{hash6}` at 29 modules', async () => {
		const hashed = 'evacuee:01K5Z8Q2J9M7X3V4B6N8C0D2EF@683508';
		expect(hashed).toHaveLength(41);
		await expect(qrModuleCount(hashed)).resolves.toBe(29);
		await expect(qrModuleCount(hashed)).resolves.toBe(
			await qrModuleCount('evacuee:01K5Z8Q2J9M7X3V4B6N8C0D2EF')
		);
	});

	it('does not generate a data URL during SSR', async () => {
		await expect(generateQrDataUrl('x')).resolves.toBe('');
	});

	it('does not generate a data URL for empty text', async () => {
		await expect(generateQrDataUrl('')).resolves.toBe('');
	});
});
