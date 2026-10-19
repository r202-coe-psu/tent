import { beforeEach, describe, expect, it, vi } from 'vitest';

const scrollAppToTop = vi.fn();

vi.mock('$lib/utils/scroll-app-to-top', () => ({
	scrollAppToTop: () => scrollAppToTop()
}));

const { DonationStore } = await import('./donation.svelte');

describe('DonationStore.goToStep', () => {
	beforeEach(() => {
		scrollAppToTop.mockReset();
	});

	it('switches the step and scrolls the page back to the top', async () => {
		const store = new DonationStore();

		store.goToStep('form');

		expect(store.activeTab).toBe('form');
		await vi.waitFor(() => expect(scrollAppToTop).toHaveBeenCalledTimes(1));
	});

	it('scrolls on the way back too', async () => {
		const store = new DonationStore();
		store.goToStep('time');
		await vi.waitFor(() => expect(scrollAppToTop).toHaveBeenCalledTimes(1));

		store.goToStep('form');

		expect(store.activeTab).toBe('form');
		await vi.waitFor(() => expect(scrollAppToTop).toHaveBeenCalledTimes(2));
	});

	it('reset() returns to the needs board at the top of the page', async () => {
		const store = new DonationStore();
		store.goToStep('ticket');
		await vi.waitFor(() => expect(scrollAppToTop).toHaveBeenCalledTimes(1));

		store.reset();

		expect(store.activeTab).toBe('needs');
		await vi.waitFor(() => expect(scrollAppToTop).toHaveBeenCalledTimes(2));
	});
});
