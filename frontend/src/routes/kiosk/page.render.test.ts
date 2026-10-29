import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/svelte-query';
import { render } from 'svelte/server';
import Page from './+page.svelte';

vi.mock('$app/state', () => ({ page: { url: new URL('http://kiosk.test/kiosk') } }));
vi.mock('$lib/features/kiosk/data/kiosk-banners.api', () => ({
	fetchKioskBanners: vi.fn().mockResolvedValue([])
}));

describe('kiosk home page', () => {
	it('shows the identity method selector and no attract overlay while there are no banners', () => {
		const { body } = render(Page, {
			props: {
				params: {},
				data: {
					queryClient: new QueryClient(),
					qrCheckInEnabled: true,
					phoneCheckInEnabled: true,
					thaidCheckInEnabled: false,
					walkInRegistrationEnabled: false
				}
			}
		});

		expect(body).toContain('aria-labelledby="method-title"');
		expect(body).not.toContain('kiosk-banner-attract');
	});

	it('has no separate round test-print button: test print lives in the device-info panel', () => {
		const { body } = render(Page, {
			props: {
				params: {},
				data: {
					queryClient: new QueryClient(),
					qrCheckInEnabled: true,
					phoneCheckInEnabled: true,
					thaidCheckInEnabled: false,
					walkInRegistrationEnabled: false
				}
			}
		});

		expect(body).not.toContain('kiosk-test-print-button');
		expect(body).toContain('kiosk-device-info-button');
	});
});
