import { describe, expect, it, vi } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { fetchKioskHardware } from '$lib/features/kiosk/config';
import { load } from './+page';

vi.mock('$lib/features/kiosk/config', async () => {
	const actual = await vi.importActual<typeof import('$lib/features/kiosk/config')>(
		'$lib/features/kiosk/config'
	);
	return { ...actual, fetchKioskHardware: vi.fn() };
});

const hardware = (qrCheckInEnabled: boolean) => ({
	qrCheckInEnabled,
	qrInput: 'camera' as const,
	cameraLabel: null,
	readerMaxGapMs: 50,
	faceCheck: { mode: 'off' as const, flows: [] }
});

describe('kiosk QR route load', () => {
	it('redirects to kiosk home when this machine has QR check-in off', async () => {
		vi.mocked(fetchKioskHardware).mockResolvedValueOnce(hardware(false));
		const url = new URL(
			'https://tent.example.go.th/kiosk/qr?shelter_name=Shelter%201&shelter_code=SH001&station_name=Desk%201&device_name=Kiosk%201&device_secret=must-not-forward'
		);
		let caught: unknown;

		try {
			await load({ url, fetch: vi.fn() } as unknown as Parameters<typeof load>[0]);
		} catch (error) {
			caught = error;
		}

		expect(isRedirect(caught)).toBe(true);
		if (!isRedirect(caught)) throw new Error('Expected SvelteKit redirect');
		expect(caught).toMatchObject({
			status: 307,
			location:
				'/kiosk?shelter_name=Shelter+1&shelter_code=SH001&station_name=Desk+1&device_name=Kiosk+1'
		});
	});

	it('opens the QR screen when QR check-in is on (the default)', async () => {
		vi.mocked(fetchKioskHardware).mockResolvedValueOnce(hardware(true));
		const url = new URL('https://tent.example.go.th/kiosk/qr?shelter_code=SH001');

		await expect(
			load({ url, fetch: vi.fn() } as unknown as Parameters<typeof load>[0])
		).resolves.toBeUndefined();
	});
});
