import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_KIOSK_HARDWARE } from '../domain/kiosk-hardware';
import {
	fetchKioskHardware,
	KIOSK_HARDWARE_PATH,
	KIOSK_HARDWARE_TIMEOUT_MS
} from './kiosk-hardware.api';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('fetchKioskHardware', () => {
	it('maps the scanner client response and makes an uncached same-origin POST', async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				json({ qr_input: 'both', camera_label: ' JSK-RGB ', reader_max_gap_ms: 40 })
			);

		await expect(fetchKioskHardware(fetchFn)).resolves.toEqual({
			qrInput: 'both',
			cameraLabel: 'JSK-RGB',
			readerMaxGapMs: 40
		});
		expect(fetchFn).toHaveBeenCalledWith(
			KIOSK_HARDWARE_PATH,
			expect.objectContaining({
				method: 'POST',
				cache: 'no-store',
				signal: expect.any(AbortSignal)
			})
		);
		expect(KIOSK_HARDWARE_TIMEOUT_MS).toBe(3_000);
	});

	it('treats a blank label as no label', async () => {
		const result = await fetchKioskHardware(
			vi
				.fn<typeof fetch>()
				.mockResolvedValue(json({ qr_input: 'both', camera_label: '  ', reader_max_gap_ms: 50 }))
		);
		expect(result.cameraLabel).toBeNull();
	});

	it('falls back to the default when the body is not an object', async () => {
		for (const body of [5, []]) {
			await expect(
				fetchKioskHardware(vi.fn<typeof fetch>().mockResolvedValue(json(body)))
			).resolves.toEqual(DEFAULT_KIOSK_HARDWARE);
		}
	});

	it('treats a missing label as no label', async () => {
		const result = await fetchKioskHardware(
			vi
				.fn<typeof fetch>()
				.mockResolvedValue(json({ qr_input: 'reader', camera_label: null, reader_max_gap_ms: 50 }))
		);
		expect(result).toEqual({ qrInput: 'reader', cameraLabel: null, readerMaxGapMs: 50 });
	});

	it('falls back to the camera default without a scanner client or on any bad response', async () => {
		const cases = [
			vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 })),
			vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>', { status: 200 })),
			vi.fn<typeof fetch>().mockResolvedValue(json(null)),
			vi.fn<typeof fetch>().mockResolvedValue(json({ qr_input: 'bluetooth' })),
			vi.fn<typeof fetch>().mockResolvedValue(json({})),
			vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')),
			vi
				.fn<typeof fetch>()
				.mockRejectedValue(new DOMException('The operation timed out', 'TimeoutError'))
		];
		for (const fetchFn of cases) {
			await expect(fetchKioskHardware(fetchFn)).resolves.toEqual(DEFAULT_KIOSK_HARDWARE);
		}
		expect(DEFAULT_KIOSK_HARDWARE.qrInput).toBe('camera');
	});

	it('replaces an out-of-range reader gap with the default', async () => {
		for (const gap of [5, 101, 12.5, '40', null]) {
			const result = await fetchKioskHardware(
				vi
					.fn<typeof fetch>()
					.mockResolvedValue(json({ qr_input: 'reader', reader_max_gap_ms: gap }))
			);
			expect(result.readerMaxGapMs).toBe(50);
		}
	});
});
