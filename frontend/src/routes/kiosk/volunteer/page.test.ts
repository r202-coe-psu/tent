import { describe, expect, it, vi } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { fetchKioskConfig } from '$lib/features/kiosk/config';
import { load } from './+page';

vi.mock('$lib/features/kiosk/config', async () => {
	const actual = await vi.importActual<typeof import('$lib/features/kiosk/config')>(
		'$lib/features/kiosk/config'
	);
	return { ...actual, fetchKioskConfig: vi.fn() };
});

const config = (phoneCheckInEnabled: boolean) => ({
	phoneCheckInEnabled,
	thaidCheckInEnabled: false,
	walkInRegistrationEnabled: false
});

describe('kiosk volunteer route load', () => {
	it('redirects to kiosk home with the display context when the phone method is disabled', async () => {
		vi.mocked(fetchKioskConfig).mockResolvedValueOnce(config(false));
		const url = new URL(
			'https://tent.example.go.th/kiosk/volunteer?shelter_name=Shelter%201&shelter_code=SH001&station_name=Desk%201&device_name=Kiosk%201&device_secret=must-not-forward'
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

	it('allows the route when the phone method is enabled', async () => {
		vi.mocked(fetchKioskConfig).mockResolvedValueOnce(config(true));
		const url = new URL('https://tent.example.go.th/kiosk/volunteer?shelter_code=SH001');

		await expect(
			load({ url, fetch: vi.fn() } as unknown as Parameters<typeof load>[0])
		).resolves.toBeUndefined();
	});
});
