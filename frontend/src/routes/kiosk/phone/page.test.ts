import { describe, expect, it, vi } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { fetchKioskConfig } from '$lib/features/kiosk';
import { load } from './+page';

vi.mock('$lib/features/kiosk', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/kiosk')>()),
	fetchKioskConfig: vi.fn()
}));

describe('kiosk phone route load', () => {
	it('redirects to kiosk home when the shelter has phone check-in disabled', async () => {
		vi.mocked(fetchKioskConfig).mockResolvedValueOnce({ phoneCheckInEnabled: false });
		const url = new URL(
			'https://tent.example.go.th/kiosk/phone?shelter_name=Shelter%201&shelter_code=SH001&station_name=Desk%201&device_name=Kiosk%201&device_secret=must-not-forward'
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

	it('allows the route only when the shelter setting is enabled', async () => {
		vi.mocked(fetchKioskConfig).mockResolvedValueOnce({ phoneCheckInEnabled: true });
		const url = new URL('https://tent.example.go.th/kiosk/phone?shelter_code=SH001');

		await expect(
			load({ url, fetch: vi.fn() } as unknown as Parameters<typeof load>[0])
		).resolves.toBeUndefined();
	});

	it('fails closed when config cannot be read', async () => {
		vi.mocked(fetchKioskConfig).mockResolvedValueOnce({ phoneCheckInEnabled: false });
		const url = new URL('https://tent.example.go.th/kiosk/phone');
		let caught: unknown;
		try {
			await load({ url, fetch: vi.fn() } as unknown as Parameters<typeof load>[0]);
		} catch (error) {
			caught = error;
		}
		expect(isRedirect(caught)).toBe(true);
	});
});
