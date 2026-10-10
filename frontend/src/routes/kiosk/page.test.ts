import { describe, expect, it, vi } from 'vitest';
import { fetchKioskConfig, fetchKioskHardware } from '$lib/features/kiosk/config';
import { load } from './+page';

vi.mock('$lib/features/kiosk/config', () => ({
	fetchKioskConfig: vi.fn(),
	fetchKioskHardware: vi.fn()
}));

const hardware = (qrCheckInEnabled: boolean) => ({
	qrCheckInEnabled,
	qrInput: 'camera' as const,
	cameraLabel: null,
	readerMaxGapMs: 50,
	faceCheck: { mode: 'off' as const, flows: [] }
});

describe('kiosk home route load', () => {
	it.each([true, false])('returns the shelter phone flag (%s)', async (enabled) => {
		vi.mocked(fetchKioskConfig).mockResolvedValueOnce({
			phoneCheckInEnabled: enabled,
			thaidCheckInEnabled: false,
			walkInRegistrationEnabled: false
		});
		vi.mocked(fetchKioskHardware).mockResolvedValueOnce(hardware(true));
		const fetch = vi.fn<typeof globalThis.fetch>();

		await expect(load({ fetch } as unknown as Parameters<typeof load>[0])).resolves.toEqual({
			qrCheckInEnabled: true,
			phoneCheckInEnabled: enabled,
			thaidCheckInEnabled: false,
			walkInRegistrationEnabled: false
		});
		expect(fetchKioskConfig).toHaveBeenCalledWith(fetch);
		expect(fetchKioskHardware).toHaveBeenCalledWith(fetch);
	});

	it('returns the machine QR check-in flag from the scanner client', async () => {
		vi.mocked(fetchKioskConfig).mockResolvedValueOnce({
			phoneCheckInEnabled: true,
			thaidCheckInEnabled: true,
			walkInRegistrationEnabled: false
		});
		vi.mocked(fetchKioskHardware).mockResolvedValueOnce(hardware(false));

		await expect(
			load({ fetch: vi.fn() } as unknown as Parameters<typeof load>[0])
		).resolves.toMatchObject({ qrCheckInEnabled: false });
	});
});
