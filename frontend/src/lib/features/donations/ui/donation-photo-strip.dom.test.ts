// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

const repo = {
	getThumbnailUrl: vi.fn<(id: string) => Promise<string | null>>(),
	getFullImageUrl: vi.fn<(id: string) => Promise<string | null>>()
};
const imageRepository = vi.fn<(shelterCode?: string) => typeof repo>(() => repo);
vi.mock('$lib/features/images', () => ({ imageRepository }));

const { default: DonationPhotoStrip } = await import('./donation-photo-strip.svelte');

const P1 = 'image:01K8PHXTX00000000000000001';
const P2 = 'image:01K8PHXTX00000000000000002';

let instance: ReturnType<typeof mount> | null = null;

async function render(photoIds: string[]) {
	instance = mount(DonationPhotoStrip, {
		target: document.body,
		props: { photoIds, shelterCode: 'SH001' }
	});
	flushSync();
	await vi.waitFor(() => expect(document.body.querySelectorAll('[role="status"]')).toHaveLength(0));
}

const all = (testId: string) => document.body.querySelectorAll(`[data-testid="${testId}"]`);

beforeEach(() => {
	repo.getThumbnailUrl.mockReset();
	repo.getFullImageUrl.mockReset();
	imageRepository.mockClear();
});

afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	// bits-ui releases the body scroll lock on a 24 ms timer; let it run before happy-dom tears down.
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
});

describe('DonationPhotoStrip (CR-175 donor photos)', () => {
	it('renders nothing for a booking without photos (FR-13)', async () => {
		await render([]);

		expect(all('donation-photo-strip')).toHaveLength(0);
		expect(document.body.textContent?.trim()).toBe('');
		expect(repo.getThumbnailUrl).not.toHaveBeenCalled();
	});

	it("shows every photo's thumbnail from the booking's shelter DB (AC-1)", async () => {
		repo.getThumbnailUrl.mockImplementation(async (id) => `https://thumb/${id}`);

		await render([P1, P2]);

		const imgs = [...all('donation-photo-thumb')].map((b) => b.querySelector('img')?.src);
		expect(imgs).toEqual([`https://thumb/${P1}`, `https://thumb/${P2}`]);
		expect(imageRepository).toHaveBeenCalledWith('SH001');
		expect(document.body.textContent).toContain('2 รูป');
	});

	it('shows a gap for a photo that is gone and keeps the other, without an error (AC-13)', async () => {
		repo.getThumbnailUrl.mockImplementation(async (id) =>
			id === P1 ? `https://thumb/${P1}` : null
		);

		await render([P1, P2]);

		expect(all('donation-photo-thumb')).toHaveLength(1);
		expect(all('donation-photo-missing')).toHaveLength(1);
		expect(document.body.textContent).toContain('รูปไม่พร้อมใช้');
	});

	it('reads a photo that fails to load as unavailable, not as an error', async () => {
		repo.getThumbnailUrl.mockRejectedValue(new Error('network'));

		await render([P1]);

		expect(all('donation-photo-missing')).toHaveLength(1);
	});

	it('opens the full image when a thumbnail is pressed (AC-1)', async () => {
		repo.getThumbnailUrl.mockResolvedValue(`https://thumb/${P1}`);
		repo.getFullImageUrl.mockResolvedValue(`https://full/${P1}`);
		await render([P1]);

		(all('donation-photo-thumb')[0] as HTMLButtonElement).click();
		flushSync();
		await tick();

		await vi.waitFor(() => {
			const full = document.body.querySelector<HTMLImageElement>(
				'[data-testid="donation-photo-full"]'
			);
			expect(full?.src).toBe(`https://full/${P1}`);
		});
		expect(repo.getFullImageUrl).toHaveBeenCalledWith(P1);
	});
});
