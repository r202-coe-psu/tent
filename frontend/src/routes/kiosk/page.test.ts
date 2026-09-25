import { describe, expect, it, vi } from 'vitest';
import { fetchKioskConfig } from '$lib/features/kiosk';
import { load } from './+page';

vi.mock('$lib/features/kiosk', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/kiosk')>()),
	fetchKioskConfig: vi.fn()
}));

describe('kiosk home route load', () => {
	it.each([true, false])('returns the shelter phone flag (%s)', async (enabled) => {
		vi.mocked(fetchKioskConfig).mockResolvedValueOnce({ phoneCheckInEnabled: enabled });
		const fetch = vi.fn<typeof globalThis.fetch>();

		await expect(load({ fetch } as unknown as Parameters<typeof load>[0])).resolves.toEqual({
			phoneCheckInEnabled: enabled
		});
		expect(fetchKioskConfig).toHaveBeenCalledWith(fetch);
	});
});
